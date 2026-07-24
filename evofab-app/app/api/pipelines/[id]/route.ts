// route.ts (api/pipelines/[id])
// One pipeline run's step-by-step progress, results, and the live status of
// every machine it uses — backs the History page's run detail view.
// Replaces the former mockData.ts RESULTS/PROGRESS/MACHINE_STATUS constants.
//
// Convention: a completed step's `outputs` jsonb is expected to hold
// `{ summary: string }` for its results-table row; falls back to a raw JSON
// dump if that's absent.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/app/lib/supabase-server'

const TERMINAL_PIPELINE_STATUSES = new Set(['complete', 'failed', 'aborted'])

const STATE_DOT_CLASS: Record<string, string> = {
  idle: 'bg-green',
  busy: 'bg-teal',
  paused: 'bg-amber',
  error: 'bg-red',
  offline: 'bg-muted',
}

interface StepRow {
  id: string
  step_order: number
  status: string
  sync_group_id: string | null
  outputs: Record<string, unknown> | null
  completed_at: string | null
  machine_id: string | null
  machines: { name: string } | null
  machine_types: { type_key: string } | null
  action_types: { display_name: string } | null
}

/** GET /api/pipelines/[id] — Returns a pipeline run's summary, step progress, results, and machine statuses. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const { data: pipeline, error: pipelineError } = await supabase
    .from('pipelines')
    .select('id, name, status')
    .eq('id', id)
    .single()

  if (pipelineError || !pipeline) {
    return NextResponse.json(
      { error: pipelineError?.message ?? 'Pipeline not found' },
      { status: 404 }
    )
  }

  const { data: stepsData, error: stepsError } = await supabase
    .from('pipeline_steps')
    .select(
      'id, step_order, status, sync_group_id, outputs, completed_at, machine_id, machines(name), machine_types(type_key), action_types(display_name)'
    )
    .eq('pipeline_id', id)
    .order('step_order')

  if (stepsError) return NextResponse.json({ error: stepsError.message }, { status: 500 })

  const steps = (stepsData ?? []) as unknown as StepRow[]

  const progress = steps.map((s) => ({
    num: s.step_order,
    tech: s.machine_types?.type_key,
    label: s.action_types?.display_name ?? '',
    machine: s.machines?.name ?? '—',
    status: s.status,
    group: s.sync_group_id ?? undefined,
  }))

  const results = steps
    .filter((s) => s.status === 'complete' && s.outputs && Object.keys(s.outputs).length > 0)
    .map((s) => ({
      type: s.action_types?.display_name ?? '',
      ts: s.completed_at
        ? new Date(s.completed_at).toLocaleTimeString('en-US', { hour12: false })
        : '',
      result:
        typeof s.outputs?.summary === 'string' ? s.outputs.summary : JSON.stringify(s.outputs),
    }))

  const machineIds = [...new Set(steps.map((s) => s.machine_id).filter((v): v is string => !!v))]

  let machineStatus: { name: string; state: string; dotColorClass: string }[] = []
  if (machineIds.length > 0) {
    const { data: statusRows } = await supabase
      .from('machine_status')
      .select('status, machines(name)')
      .in('machine_id', machineIds)
    machineStatus = ((statusRows ?? []) as unknown as { status: string; machines: { name: string } | null }[]).map(
      (row) => ({
        name: row.machines?.name ?? '—',
        state: row.status,
        dotColorClass: STATE_DOT_CLASS[row.status] ?? 'bg-muted',
      })
    )
  }

  return NextResponse.json({ pipeline, progress, results, machineStatus })
}

/**
 * PATCH /api/pipelines/[id] — Body: `{ status }`. Updates a run's overall status, stamping
 * `completed_at` when it reaches a terminal status (`complete`/`failed`/`aborted`).
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const body = await req.json()

  const status: string | undefined = body.status
  if (!status) return NextResponse.json({ error: 'status is required' }, { status: 400 })

  const update: Record<string, unknown> = { status }
  if (TERMINAL_PIPELINE_STATUSES.has(status)) update.completed_at = new Date().toISOString()

  const { data, error } = await supabase
    .from('pipelines')
    .update(update)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ pipeline: data })
}
