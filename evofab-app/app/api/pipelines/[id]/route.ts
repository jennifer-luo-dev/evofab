// route.ts (api/pipelines/[id])
// One pipeline run's step-by-step progress, results, and the live status of
// every machine it uses — backs the History page's run detail view.
// Replaces the former mockData.ts RESULTS/PROGRESS/MACHINE_STATUS constants.
//
// Convention: a completed step's `outputs` jsonb holds `{ summary: string }`
// for its results-table row.
//
// The step columns come from narrow queries, never one wide `select=...,outputs`:
// camera steps fill `outputs` with a base64 photo + depth frame (~2 MB each),
// so a 50-iteration loop made that select detoast ~100 MB and blow Postgres's
// statement timeout, 500ing the whole page. Instead: (1) every step without
// `outputs`, (2) just `outputs->>summary` for the classification steps the
// results table shows, (3) one source photo, only while a classification step
// is running live.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/app/lib/supabase-server'
import { getWebcamStreamUrl } from '@/app/lib/moonraker'
import type { JointName, JointRotation, MoveTargetBody } from '@/app/lib/robot'
import type { PrinterStatus } from '@/app/types/printer'
import type { LiveStep } from '@/app/components/history/types'

const TERMINAL_PIPELINE_STATUSES = new Set(['complete', 'failed', 'aborted'])
/** Falls back to Moonraker's default port when a machine row has none set — mirrors `/api/printers`. */
const DEFAULT_MOONRAKER_PORT = 7125

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
  iteration_path: number[] | null
  inputs: Record<string, string> | null
  completed_at: string | null
  machine_id: string | null
  machines: { name: string; ip: string | null; port: number | null } | null
  machine_types: { type_key: string } | null
  action_types: { display_name: string } | null
}

const STEP_SELECT =
  'id, step_order, status, sync_group_id, iteration_path, inputs, completed_at, machine_id, ' +
  'machines(name, ip, port), machine_types(type_key), action_types(display_name)'

/** Excludes inert loop-body definition rows (group_id set, iteration_path still null) — they never
 * dispatch, so they'd otherwise show up stuck at `pending`. Matches the execution loop's own filter. */
const REAL_STEP_FILTER = 'iteration_path.not.is.null,group_id.is.null'

/**
 * Reconstructs a robot_arm Move step's target from its persisted `inputs` — mirrors
 * `moveRobotArm`'s own parsing in stepExecutors.ts, since that logic lives client-side and
 * isn't reusable here. Returns null for a malformed/incomplete input set (e.g. a step whose
 * draft was never finished) rather than throwing — this is a read-only display, not dispatch.
 */
function parseRobotTarget(inputs: Record<string, string> | null): MoveTargetBody | null {
  if (!inputs) return null
  const speed_pct = parseFloat(inputs.speed_pct) || 25
  const acceleration_pct = parseFloat(inputs.acceleration_pct) || 25

  if (inputs.target_type === 'joint') {
    let joints: JointRotation[] = []
    try {
      const parsed = JSON.parse(inputs.joints || '[]')
      if (Array.isArray(parsed)) joints = parsed as { joint: JointName; angle_deg: number }[]
    } catch {
      joints = []
    }
    if (joints.length === 0) return null
    return {
      target_type: 'joint',
      mode: inputs.mode === 'relative' ? 'relative' : 'absolute',
      joints,
      speed_pct,
      acceleration_pct,
    }
  }

  const x = parseFloat(inputs.x)
  const y = parseFloat(inputs.y)
  const z = parseFloat(inputs.z)
  if (![x, y, z].every(Number.isFinite)) return null
  return { target_type: 'cartesian', position: { x, y, z }, speed_pct, acceleration_pct }
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

  // (1) Every real step, minus the heavy `outputs` column — drives the progress tracker.
  const { data: stepsData, error: stepsError } = await supabase
    .from('pipeline_steps')
    .select(STEP_SELECT)
    .eq('pipeline_id', id)
    .or(REAL_STEP_FILTER)
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

  // (2) `outputs->>summary` only, and only for the completed classification steps the results
  // table renders — pulling that scalar out of jsonb stays cheap where selecting the whole
  // `outputs` column (with a camera step's ~2 MB photo/depth blobs in it) times the query out.
  // Camera / actuation / move rows are omitted here exactly as HistoryResultsTable already
  // filters them out of what it shows.
  const { data: summaryRows } = await supabase
    .from('pipeline_steps')
    .select('id, summary:outputs->>summary, machine_types!inner(type_key)')
    .eq('pipeline_id', id)
    .eq('status', 'complete')
    .eq('machine_types.type_key', 'classification_model')
    .or(REAL_STEP_FILTER)
  const summaryById = new Map(
    ((summaryRows ?? []) as unknown as { id: string; summary: string | null }[])
      .filter((r) => r.summary !== null)
      .map((r) => [r.id, r.summary as string])
  )

  const results = steps
    .filter((s) => summaryById.has(s.id))
    .map((s) => ({
      type: s.action_types?.display_name ?? '',
      tech: s.machine_types?.type_key ?? '',
      ts: s.completed_at
        ? new Date(s.completed_at).toLocaleTimeString('en-US', { hour12: false })
        : '',
      result: summaryById.get(s.id) ?? '',
      trial: s.iteration_path?.length ? s.iteration_path.join('.') : null,
      // The measurement's source photo lives on the camera step it references. The results table
      // loads it lazily from /api/pipeline-steps/[id]/image, so the heavy `outputs` jsonb (base64
      // photo + depth) is never pulled in bulk here.
      photoStepId: s.inputs?.photo_source ?? null,
      imageUrl: null as string | null,
    }))

  const machineIds = [...new Set(steps.map((s) => s.machine_id).filter((v): v is string => !!v))]

  const machineStatus: {
    name: string
    state: string
    dotColorClass: string
    telemetry?: Record<string, unknown>
  }[] = []
  /** Keyed by `machine_id` (not name) so the live-step lookup below doesn't need a second query. */
  const telemetryByMachineId = new Map<string, Record<string, unknown>>()
  if (machineIds.length > 0) {
    const { data: statusRows } = await supabase
      .from('machine_status')
      .select('machine_id, status, telemetry, machines(name)')
      .in('machine_id', machineIds)
    for (const row of (statusRows ?? []) as unknown as {
      machine_id: string
      status: string
      telemetry: Record<string, unknown> | null
      machines: { name: string } | null
    }[]) {
      if (row.telemetry && Object.keys(row.telemetry).length > 0) {
        telemetryByMachineId.set(row.machine_id, row.telemetry)
      }
      machineStatus.push({
        name: row.machines?.name ?? '—',
        state: row.status,
        dotColorClass: STATE_DOT_CLASS[row.status] ?? 'bg-muted',
        telemetry: telemetryByMachineId.get(row.machine_id),
      })
    }
  }

  // The step (if any) the run is currently on — drives the History page's live "Now Running"
  // side panel, the read-only counterpart to PipelineBuilder's StepMonitorCard. Only the first
  // running step is used, matching the builder's single `currentStepId`/`runningX` state today
  // (synced-group steps do run concurrently, but the builder itself has no multi-step live view
  // to mirror).
  const runningStep = steps.find((s) => s.status === 'running') ?? null
  let liveStep: LiveStep | null = null
  if (runningStep) {
    const tech = runningStep.machine_types?.type_key
    const label = runningStep.action_types?.display_name ?? ''
    const machine = runningStep.machines?.name ?? '—'

    if (tech === 'printer') {
      const machineRow = runningStep.machines
      const streamUrl = machineRow?.ip
        ? await getWebcamStreamUrl(machineRow.ip, machineRow.port ?? DEFAULT_MOONRAKER_PORT).catch(() => null)
        : null
      const printerStatus = runningStep.machine_id
        ? ((telemetryByMachineId.get(runningStep.machine_id) as PrinterStatus | undefined) ?? null)
        : null
      liveStep = { tech: 'printer', label, machine, streamUrl, printerStatus }
    } else if (tech === 'robot_arm') {
      liveStep = { tech: 'robot_arm', label, machine, target: parseRobotTarget(runningStep.inputs) }
    } else if (tech === 'camera') {
      liveStep = { tech: 'camera', label, machine }
    } else if (tech === 'classification_model') {
      // (3) One targeted read of the source camera step's photo, only while a classification step
      // is actually running — a single row, cheap even if its `image_keys` is still a fat data URL.
      const sourceStepId = runningStep.inputs?.photo_source
      let sourceImageUrl: string | null = null
      if (sourceStepId) {
        const { data: src } = await supabase
          .from('pipeline_steps')
          .select('image_keys:outputs->image_keys')
          .eq('id', sourceStepId)
          .maybeSingle()
        const imageKeys = (src as { image_keys?: unknown } | null)?.image_keys
        if (Array.isArray(imageKeys) && typeof imageKeys[0] === 'string') sourceImageUrl = imageKeys[0]
      }
      liveStep = { tech: 'classification_model', label, machine, sourceImageUrl }
    }
  }

  return NextResponse.json({ pipeline, progress, results, machineStatus, liveStep })
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

/**
 * DELETE /api/pipelines/[id] — Removes a run and everything under it (its steps, loop
 * definitions, and any `machine_status.current_step_id` pointer into those steps). For clearing
 * out runs stuck at `status: 'running'` from a dev-session crash/reload, or any other run a
 * researcher wants gone from History — there's no soft-delete/archive concept, this is permanent.
 */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  // Steps referenced by a stale `machine_status.current_step_id` would otherwise block the
  // `pipeline_steps` delete below via its foreign key.
  const { data: stepRows, error: stepIdsError } = await supabase
    .from('pipeline_steps')
    .select('id')
    .eq('pipeline_id', id)
  if (stepIdsError) return NextResponse.json({ error: stepIdsError.message }, { status: 500 })

  const stepIds = (stepRows ?? []).map((s) => s.id)
  if (stepIds.length > 0) {
    const { error: unlinkError } = await supabase
      .from('machine_status')
      .update({ current_step_id: null })
      .in('current_step_id', stepIds)
    if (unlinkError) return NextResponse.json({ error: unlinkError.message }, { status: 500 })
  }

  const { error: logsError } = await supabase.from('pipeline_step_logs').delete().eq('pipeline_id', id)
  if (logsError) return NextResponse.json({ error: logsError.message }, { status: 500 })

  const { error: stepsError } = await supabase.from('pipeline_steps').delete().eq('pipeline_id', id)
  if (stepsError) return NextResponse.json({ error: stepsError.message }, { status: 500 })

  const { error: groupsError } = await supabase.from('pipeline_step_groups').delete().eq('pipeline_id', id)
  if (groupsError) return NextResponse.json({ error: groupsError.message }, { status: 500 })

  const { error: pipelineError } = await supabase.from('pipelines').delete().eq('id', id)
  if (pipelineError) return NextResponse.json({ error: pipelineError.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
