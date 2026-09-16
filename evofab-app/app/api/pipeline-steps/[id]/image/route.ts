// route.ts (api/pipeline-steps/[id]/image)
// Serves the photo a camera step captured — decoded from that step's
// `pipeline_steps.outputs.image_keys[0]`, which is stored as a `data:` URL.
//
// A single-row lookup, deliberately kept out of GET /api/pipelines/[id]: that
// route never selects the `outputs` column in bulk because a 50-iteration run
// packs ~100 MB of base64 photo/depth into it and detoasting all of that at
// once blows Postgres's statement timeout (see that route's header). One row
// at a time, lazily from the History results table, is fine.

import { createClient } from '@/app/lib/supabase-server'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('pipeline_steps')
    .select('image_keys:outputs->image_keys')
    .eq('id', id)
    .maybeSingle()

  if (error) return new Response(error.message, { status: 500 })

  const keys = (data as { image_keys?: unknown } | null)?.image_keys
  const src = Array.isArray(keys) && typeof keys[0] === 'string' ? keys[0] : null
  if (!src) return new Response('No photo for this step', { status: 404 })

  const match = /^data:(image\/[\w.+-]+);base64,([\s\S]*)$/.exec(src)
  if (!match) {
    // Not an inline data URL (a future capture path could store a plain URL) — hand it back as-is.
    return Response.redirect(src, 307)
  }

  const bytes = Buffer.from(match[2], 'base64')
  return new Response(bytes, {
    headers: {
      'Content-Type': match[1],
      'Content-Length': String(bytes.length),
      // Immutable once captured — let the browser keep it so scrolling the table doesn't refetch.
      'Cache-Control': 'private, max-age=86400',
    },
  })
}
