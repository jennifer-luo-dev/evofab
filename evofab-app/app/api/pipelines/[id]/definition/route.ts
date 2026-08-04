// route.ts (api/pipelines/[id]/definition)
// Reconstructs a past run's pre-unroll builder tree (name, loop groups, and
// steps with `rootOrder`/`LoopGroup.children` containment) so the Pipelines
// builder can be re-hydrated from it — backs History's "Edit & Rerun".
//
// `pipeline_steps` only persists two kinds of rows (see schema.sql): an
// always-real top-level step (`group_id` null, `iteration_path` null) and,
// for a loop body, both an inert *definition* row (`group_id` set,
// `iteration_path` null — never dispatched, exists only for editing) and
// `iteration_count` real per-iteration *clone* rows (`iteration_path` set).
// Definitions alone aren't enough to rebuild ordering: they're all persisted
// after every executable row (see PipelineBuilder.runPipeline's `[...
// payloadExecutable, ...payloadDefinitions]`), so their `step_order` doesn't
// interleave correctly with top-level steps. Each loop's *first-iteration*
// clone rows, though, live in the same executable batch as the top-level
// steps and were written in true tree order — so filtering to "always-real
// top-level rows, plus clones whose `iteration_path` is all 1s" reconstructs
// exactly one row per original builder step, in correct relative order.
// From there, each row's (still-original) `group_id` — shared by every
// iteration of a given loop, see `freshenRunIds` — is enough to place it, or
// the loop it's nested in, into the right container's ordered children.

import { NextResponse } from 'next/server'
import { createClient } from '@/app/lib/supabase-server'
import type { BuilderEntry, LoopGroup, Step } from '@/app/components/pipelines/types'

interface GroupRow {
  id: string
  parent_group_id: string | null
  label: string | null
  iteration_count: number
}

interface StepRow {
  id: string
  step_order: number
  group_id: string | null
  iteration_path: number[] | null
  sync_group_id: string | null
  inputs: Record<string, string> | null
  machines: { name: string } | null
  machine_types: { type_key: string } | null
  action_types: { type_key: string } | null
}

/** GET /api/pipelines/[id]/definition — Rebuilds `{ name, rootOrder, groups, steps }` for the Pipelines builder. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const { data: pipeline, error: pipelineError } = await supabase
    .from('pipelines')
    .select('id, name')
    .eq('id', id)
    .single()
  if (pipelineError || !pipeline) {
    return NextResponse.json({ error: pipelineError?.message ?? 'Pipeline not found' }, { status: 404 })
  }

  const { data: groupsData, error: groupsError } = await supabase
    .from('pipeline_step_groups')
    .select('id, parent_group_id, label, iteration_count')
    .eq('pipeline_id', id)
  if (groupsError) return NextResponse.json({ error: groupsError.message }, { status: 500 })
  const groupRows = (groupsData ?? []) as GroupRow[]
  const parentOf = new Map(groupRows.map((g) => [g.id, g.parent_group_id]))

  const { data: stepsData, error: stepsError } = await supabase
    .from('pipeline_steps')
    .select(
      'id, step_order, group_id, iteration_path, sync_group_id, inputs, machines(name), machine_types(type_key), action_types(type_key)'
    )
    .eq('pipeline_id', id)
    .order('step_order')
  if (stepsError) return NextResponse.json({ error: stepsError.message }, { status: 500 })
  const allRows = (stepsData ?? []) as unknown as StepRow[]

  // One row per original builder step (see header comment): an always-real top-level row, or a
  // loop-body clone whose iteration_path is entirely 1s (its loop's first iteration at every
  // nesting level) — already in step_order (tree) order from the query above.
  const templateRows = allRows.filter((r) =>
    r.iteration_path === null ? r.group_id === null : r.iteration_path.every((x) => x === 1)
  )

  function ancestorChain(groupId: string | null): string[] {
    const chain: string[] = []
    let current = groupId
    while (current !== null) {
      chain.unshift(current)
      current = parentOf.get(current) ?? null
    }
    return chain
  }

  /**
   * A row's placement within `containerId`'s children: itself as a step when its own group_id
   * is that container, the direct-child loop it (or an ancestor loop of it) descends from when
   * nested deeper, or `null` when it belongs to an unrelated branch entirely.
   */
  function directChildKey(
    containerId: string | null,
    rowGroupId: string | null
  ): { kind: 'step' } | { kind: 'loop'; id: string } | null {
    if (rowGroupId === containerId) return { kind: 'step' }
    const chain = ancestorChain(rowGroupId)
    const containerChain = ancestorChain(containerId)
    if (containerChain.length >= chain.length) return null
    for (let i = 0; i < containerChain.length; i++) {
      if (containerChain[i] !== chain[i]) return null
    }
    return { kind: 'loop', id: chain[containerChain.length] }
  }

  function buildChildren(containerId: string | null): BuilderEntry[] {
    const entries: BuilderEntry[] = []
    const seenLoopIds = new Set<string>()
    for (const row of templateRows) {
      const key = directChildKey(containerId, row.group_id)
      if (!key) continue
      if (key.kind === 'step') {
        entries.push({ kind: 'step', id: row.id })
      } else if (!seenLoopIds.has(key.id)) {
        seenLoopIds.add(key.id)
        entries.push({ kind: 'loop', id: key.id })
      }
    }
    return entries
  }

  const rootOrder = buildChildren(null)
  const groups: LoopGroup[] = groupRows.map((g) => ({
    id: g.id,
    parentGroupId: g.parent_group_id,
    label: g.label ?? '',
    iterationCount: g.iteration_count,
    children: buildChildren(g.id),
  }))

  // Printer files are never persisted (POST /api/print streams straight to Moonraker) and print
  // settings/material profile aren't part of the persisted payload either (see
  // PipelineBuilder.runPipeline's toStepPayload) — both come back empty/default here, same as
  // any other field this endpoint simply can't recover; the builder surfaces that as a
  // needs-re-upload warning once hydrated.
  const steps: Step[] = templateRows.map((r) => ({
    id: r.id,
    tech: r.machine_types?.type_key ?? '',
    action: r.action_types?.type_key ?? '',
    machine: r.machines?.name ?? '',
    inputs: r.inputs ?? {},
    files: {},
    materialProfileId: null,
    syncGroupId: r.sync_group_id ?? null,
    num: 0,
    groupId: r.group_id ?? null,
  }))

  return NextResponse.json({ name: pipeline.name, rootOrder, groups, steps })
}
