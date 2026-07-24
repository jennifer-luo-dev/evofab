// route.ts (api/pipelines)
// Lists pipeline runs newest-first with their step counts — backs the
// History page's run list. Also creates new runs: POST persists the
// pipeline builder's current step list to `pipelines`/`pipeline_steps` so
// the run survives a reload and shows up in History immediately, before any
// step has actually executed — see PipelineBuilder.runPipeline().

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/app/lib/supabase-server'

/** GET /api/pipelines — Returns all pipeline runs, newest-first. */
export async function GET() {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('pipelines')
    .select('id, name, status, created_at, pipeline_steps(count)')
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const pipelines = (data ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    date: new Date(p.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    status: p.status,
    steps: (p.pipeline_steps as unknown as { count: number }[])?.[0]?.count ?? 0,
  }))

  return NextResponse.json({ pipelines })
}

interface PipelineStepInput {
  machineTypeId: string
  machineId: string | null
  actionTypeId: string
  syncGroupId: string | null
  inputs: Record<string, unknown>
}

/**
 * POST /api/pipelines — Creates a pipeline run (status `running`) and its steps (status
 * `pending`, in the given order) in one shot. Body: `{ name: string, steps: PipelineStepInput[] }`.
 * Returns `{ pipeline, steps }`, both including their generated ids.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const body = await req.json()

  const name: string = body.name || 'Untitled Pipeline'
  const steps: PipelineStepInput[] = Array.isArray(body.steps) ? body.steps : []

  const { data: pipeline, error: pipelineError } = await supabase
    .from('pipelines')
    .insert({ name, status: 'running', started_at: new Date().toISOString() })
    .select()
    .single()

  if (pipelineError) return NextResponse.json({ error: pipelineError.message }, { status: 500 })

  if (steps.length === 0) {
    return NextResponse.json({ pipeline, steps: [] }, { status: 201 })
  }

  const { data: stepRows, error: stepsError } = await supabase
    .from('pipeline_steps')
    .insert(
      steps.map((s, i) => ({
        pipeline_id: pipeline.id,
        step_order: i + 1,
        machine_type_id: s.machineTypeId,
        machine_id: s.machineId,
        action_type_id: s.actionTypeId,
        sync_group_id: s.syncGroupId,
        inputs: s.inputs ?? {},
        status: 'pending',
      }))
    )
    .select()
    .order('step_order')

  if (stepsError) return NextResponse.json({ error: stepsError.message }, { status: 500 })

  return NextResponse.json({ pipeline, steps: stepRows }, { status: 201 })
}
