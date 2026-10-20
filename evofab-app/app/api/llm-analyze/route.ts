// route.ts (api/llm-analyze)
// Runs an `llm_model` Analyze step: sends an earlier step's outputs (plus any
// photos among them) and the step's prompt to Claude, and returns the text
// response — see stepExecutors.ts's runLlmStep. Unlike /api/classify there's
// no hardware bridge: this calls the Claude API directly with the server-only
// ANTHROPIC_API_KEY, the same way printers skip main.py (ARCHITECTURE §2.4).
// Per-machine tuning (model/effort/system prompt) comes from that machine's
// `machine_llm_model` row, each column falling back to the defaults below.

import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/app/lib/supabase-server'

const DEFAULT_MODEL = 'claude-opus-5-5'
const DEFAULT_EFFORT = 'medium'
const MAX_TOKENS = 16000

type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'
const IMAGE_MEDIA_TYPES: readonly string[] = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']

interface MachineLlmModelDetail {
  model: string | null
  effort: Effort | null
  system_prompt: string | null
}

/** Output keys holding photos — camera's `image_keys` (data URLs) and classification_model's annotated `image_url` (a classification-bridge URL). */
const IMAGE_OUTPUT_KEYS = ['image_keys', 'image_url']

/**
 * Turns one photo reference into a base64 image block. Camera photos are already
 * `data:` URLs; anything else (e.g. the classification bridge's annotated photo, on a
 * LAN address the Claude API can't reach) is fetched here and inlined.
 */
async function toImageBlock(ref: string): Promise<Anthropic.Beta.BetaImageBlockParam> {
  let mediaType: string
  let data: string
  const dataUrl = ref.match(/^data:([^;]+);base64,(.*)$/)
  if (dataUrl) {
    mediaType = dataUrl[1]
    data = dataUrl[2]
  } else {
    const res = await fetch(ref)
    if (!res.ok) throw new Error(`Could not fetch source photo (HTTP ${res.status})`)
    mediaType = res.headers.get('content-type')?.split(';')[0] ?? 'image/jpeg'
    data = Buffer.from(await res.arrayBuffer()).toString('base64')
  }
  if (!IMAGE_MEDIA_TYPES.includes(mediaType)) throw new Error(`Unsupported photo type ${mediaType}`)
  return { type: 'image', source: { type: 'base64', media_type: mediaType as ImageMediaType, data } }
}

/** Every photo reference among a step's outputs, in output-key order. */
function collectImageRefs(outputs: Record<string, unknown>): string[] {
  return IMAGE_OUTPUT_KEYS.flatMap((key) => {
    const value = outputs[key]
    const refs = Array.isArray(value) ? value : [value]
    return refs.filter((r): r is string => typeof r === 'string' && r.length > 0)
  })
}

/** POST /api/llm-analyze — Body: `{ machineId, prompt, sourceOutputs }`. `sourceOutputs` is the
 * referenced step's `outputs` (depth arrays already stripped by runLlmStep). Returns
 * `{ text, model, usage }`. */
export async function POST(req: NextRequest) {
  const { machineId, prompt, sourceOutputs } = await req.json()

  if (!machineId || typeof prompt !== 'string' || !prompt.trim()) {
    return NextResponse.json({ error: 'machineId and prompt are required' }, { status: 400 })
  }
  if (!sourceOutputs || typeof sourceOutputs !== 'object') {
    return NextResponse.json({ error: 'sourceOutputs is required' }, { status: 400 })
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY is not set in .env.local' }, { status: 500 })
  }

  const supabase = await createClient()
  const { data: detail } = await supabase
    .from('machine_llm_model')
    .select('model, effort, system_prompt')
    .eq('machine_id', machineId)
    .maybeSingle<MachineLlmModelDetail>()

  let images: Anthropic.Beta.BetaImageBlockParam[]
  try {
    images = await Promise.all(collectImageRefs(sourceOutputs).map(toImageBlock))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 502 })
  }

  // Photos go in as image blocks above, so leave them out of the JSON dump.
  const textOutputs = Object.fromEntries(
    Object.entries(sourceOutputs).filter(([key]) => !IMAGE_OUTPUT_KEYS.includes(key))
  )

  const client = new Anthropic()
  let response: Anthropic.Beta.BetaMessage
  try {
    response = await client.beta.messages.create(
      {
        model: detail?.model || DEFAULT_MODEL,
        max_tokens: MAX_TOKENS,
        ...(detail?.system_prompt ? { system: detail.system_prompt } : {}),
        output_config: { effort: detail?.effort || DEFAULT_EFFORT },
        // On a safety decline, the API re-runs the request on a fallback model in the same call.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        messages: [
          {
            role: 'user',
            content: [
              ...images,
              {
                type: 'text',
                text: `Outputs of the source pipeline step:\n${JSON.stringify(textOutputs, null, 2)}`,
              },
              { type: 'text', text: prompt },
            ],
          },
        ],
      },
      { signal: req.signal }
    )
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      return NextResponse.json({ error: 'Claude API rejected the key — check ANTHROPIC_API_KEY' }, { status: 502 })
    }
    if (err instanceof Anthropic.RateLimitError) {
      return NextResponse.json({ error: 'Claude API rate limit hit — try again shortly' }, { status: 429 })
    }
    if (err instanceof Anthropic.APIError) {
      return NextResponse.json({ error: `Claude API error ${err.status}: ${err.message}` }, { status: 502 })
    }
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: `Claude request failed: ${message}` }, { status: 502 })
  }

  if (response.stop_reason === 'refusal') {
    const category = response.stop_details?.category
    return NextResponse.json(
      { error: `Claude declined the request${category ? ` (${category})` : ''}` },
      { status: 502 }
    )
  }

  const text = response.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim()
  const truncated = response.stop_reason === 'max_tokens'

  return NextResponse.json(
    {
      text: truncated ? `${text}\n\n[response truncated at ${MAX_TOKENS} tokens]` : text,
      model: response.model,
      usage: { input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens },
    },
    { status: 200 }
  )
}
