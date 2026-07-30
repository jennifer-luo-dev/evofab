// route.ts (api/pipelines)
// Lists pipeline runs newest-first with their step counts — backs the
// History page's run list. Also creates new runs: POST persists the
// pipeline builder's already-unrolled tree (see pipelineUtils.
// unrollForExecution) to `pipelines`/`pipeline_step_groups`/`pipeline_steps`
// so the run survives a reload and shows up in History immediately, before
// any step has actually executed — see PipelineBuilder.runPipeline().

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/app/lib/supabase-server'
import { findSyncGroupViolation, sortGroupsParentFirst } from '@/app/components/pipelines/pipelineUtils'
import type { UnrolledGroup } from '@/app/components/pipelines/types'

/** GET /api/pipelines — Returns all pipeline runs, newest-first. */
export async function GET() {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('pipelines')
    .select('id, name, status, created_at')
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Counted separately from a plain embedded `pipeline_steps(count)` so inert loop-body
  // definition rows (group_id set, iteration_path still null — never dispatched) don't inflate
  // the number a researcher sees here; matches the same filter the run detail view applies.
  const { data: realStepRows, error: stepsError } = await supabase
    .from('pipeline_steps')
    .select('pipeline_id')
    .or('iteration_path.not.is.null,group_id.is.null')

  if (stepsError) return NextResponse.json({ error: stepsError.message }, { status: 500 })

  const stepCountByPipelineId = new Map<string, number>()
  for (const row of realStepRows ?? []) {
    stepCountByPipelineId.set(row.pipeline_id, (stepCountByPipelineId.get(row.pipeline_id) ?? 0) + 1)
  }

  const pipelines = (data ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    date: new Date(p.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    status: p.status,
    steps: stepCountByPipelineId.get(p.id) ?? 0,
  }))

  return NextResponse.json({ pipelines })
}

interface PipelineStepInput {
  /**
   * Client-generated `crypto.randomUUID()` (see `usePipelineBuilder`'s `commitDraft`, and
   * `unrollForExecution` for a loop-body clone's fresh id), persisted verbatim as this row's
   * `id`. Any `step_output`-type value elsewhere in `steps[].inputs` already stores one of
   * these ids directly (remapped per-clone by `unrollForExecution`), so no id remapping is
   * needed at persist time.
   */
  id: string
  machineTypeId: string
  machineId: string | null
  actionTypeId: string
  syncGroupId: string | null
  /** The loop this row belongs to, or `null` for an always-real top-level step. */
  groupId: string | null
  /** `null` for an always-real step or an inert loop-body definition; set on a real per-iteration clone. */
  iterationPath: number[] | null
  dependsOnStepId: string | null
  inputs: Record<string, unknown>
}

/**
 * POST /api/pipelines — Creates a pipeline run (status `running`), its loop definitions, and
 * its steps (status `pending`, in the given order — real executable rows and inert loop-body
 * definitions alike) in one shot. Body: `{ name: string, groups: UnrolledGroup[], steps:
 * PipelineStepInput[] }`. Returns `{ pipeline, steps }`, both including their generated ids.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const body = await req.json()

  const name: string = body.name || 'Untitled Pipeline'
  const groups: UnrolledGroup[] = Array.isArray(body.groups) ? body.groups : []
  const steps: PipelineStepInput[] = Array.isArray(body.steps) ? body.steps : []

  // Server-side backstop on sync_group_id (see pipeline-features-breakdown.md's Sync rules):
  // the client already prevents building an invalid grouping, but this guards against a
  // client bug or a future second client writing one straight through. Checked before the
  // pipeline row is created so a rejected request doesn't leave an empty draft behind.
  const syncViolation = findSyncGroupViolation(steps)
  if (syncViolation) return NextResponse.json({ error: syncViolation }, { status: 400 })

  const { data: pipeline, error: pipelineError } = await supabase
    .from('pipelines')
    .insert({ name, status: 'running', started_at: new Date().toISOString() })
    .select()
    .single()

  if (pipelineError) return NextResponse.json({ error: pipelineError.message }, { status: 500 })

  if (groups.length > 0) {
    // Parent-before-child: a single multi-row INSERT still requires each row's own
    // `parent_group_id` reference to already be present when its row is processed.
    const { error: groupsError } = await supabase.from('pipeline_step_groups').insert(
      sortGroupsParentFirst(groups).map((g) => ({
        id: g.id,
        pipeline_id: pipeline.id,
        parent_group_id: g.parentGroupId,
        label: g.label || null,
        iteration_count: g.iterationCount,
      }))
    )
    if (groupsError) return NextResponse.json({ error: groupsError.message }, { status: 500 })
  }

  if (steps.length === 0) {
    return NextResponse.json({ pipeline, steps: [] }, { status: 201 })
  }

  const { data: stepRows, error: stepsError } = await supabase
    .from('pipeline_steps')
    .insert(
      steps.map((s, i) => ({
        id: s.id,
        pipeline_id: pipeline.id,
        step_order: i + 1,
        machine_type_id: s.machineTypeId,
        machine_id: s.machineId,
        action_type_id: s.actionTypeId,
        sync_group_id: s.syncGroupId,
        group_id: s.groupId,
        iteration_path: s.iterationPath,
        depends_on_step_id: s.dependsOnStepId,
        inputs: s.inputs ?? {},
        status: 'pending',
      }))
    )
    .select()
    .order('step_order')

  if (stepsError) return NextResponse.json({ error: stepsError.message }, { status: 500 })

  return NextResponse.json({ pipeline, steps: stepRows }, { status: 201 })
}
