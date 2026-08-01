// pipelineUtils.ts
// Pure helper functions for the pipeline builder's tree structure (steps,
// sync groups, and nested loops), for unrolling that tree into real
// executable rows at Run Pipeline time, and for describing a step's inputs.
// Shared by the builder (usePipelineBuilder, ContainerView, LoopBlock) and
// the read-only progress view on the History page (sync-grouping helpers
// only — History displays whatever rows unrollForExecution persisted, but
// has no loop-aware UI of its own; see PipelineHistoryDetail.tsx).

import type { ActionConfig, BuilderEntry, LoopGroup, Step, TechKey, UnrolledGroup, UnrolledStep } from './types'

/**
 * Depth-first flatten of the whole tree — `rootOrder`, recursing into each loop's `children`
 * in place — producing the global step ordering used for both `num` and eventual persistence
 * (a loop's body is always a contiguous block in this order, never interleaved with siblings).
 */
export function flattenTree(rootOrder: BuilderEntry[], groups: LoopGroup[]): BuilderEntry[] {
  const groupsById = new Map(groups.map((g) => [g.id, g]))
  const out: BuilderEntry[] = []
  function visit(order: BuilderEntry[]) {
    for (const entry of order) {
      out.push(entry)
      if (entry.kind === 'loop') {
        const g = groupsById.get(entry.id)
        if (g) visit(g.children)
      }
    }
  }
  visit(rootOrder)
  return out
}

/**
 * Stamps every step's `num` (global sequential display position, per `flattenTree`'s order)
 * and `groupId` (immediate parent, `null` for top-level) from the tree structure. The tree
 * (`rootOrder`/`LoopGroup.children`) is the single source of truth for both containment and
 * order; these fields are cached projections of it for display and for the eventual
 * `pipeline_steps` persistence payload. Call after any mutation to `rootOrder` or `groups`.
 */
export function deriveStepFields(steps: Step[], rootOrder: BuilderEntry[], groups: LoopGroup[]): Step[] {
  const groupsById = new Map(groups.map((g) => [g.id, g]))
  const numById = new Map<string, number>()
  const parentById = new Map<string, string | null>()
  let num = 0
  function visit(order: BuilderEntry[], parentGroupId: string | null) {
    for (const entry of order) {
      if (entry.kind === 'step') {
        num += 1
        numById.set(entry.id, num)
        parentById.set(entry.id, parentGroupId)
      } else {
        const g = groupsById.get(entry.id)
        if (g) visit(g.children, g.id)
      }
    }
  }
  visit(rootOrder, null)
  return steps.map((s) => ({ ...s, num: numById.get(s.id) ?? s.num, groupId: parentById.get(s.id) ?? null }))
}

/**
 * Groups one container's ordered entries into display "units" — consecutive step-entries
 * sharing a `syncGroupId` become one unit (what gets wrapped in a `SyncedStepGroup`); a loop
 * entry is always its own singleton unit, since sync applies to steps, not whole loops.
 */
export function computeContainerUnits(order: BuilderEntry[], stepsById: Map<string, Step>): BuilderEntry[][] {
  const units: BuilderEntry[][] = []
  let i = 0
  while (i < order.length) {
    const entry = order[i]
    const gid = entry.kind === 'step' ? stepsById.get(entry.id)?.syncGroupId : null
    if (gid) {
      const unit = [entry]
      let j = i + 1
      while (j < order.length) {
        const next = order[j]
        if (next.kind !== 'step' || stepsById.get(next.id)?.syncGroupId !== gid) break
        unit.push(next)
        j++
      }
      units.push(unit)
      i = j
    } else {
      units.push([entry])
      i++
    }
  }
  return units
}

/** Finds which container (a loop's id, or `null` for root) directly holds the entry with `entryId`, plus that container's order array. */
export function findEntryContainer(
  entryId: string,
  rootOrder: BuilderEntry[],
  groups: LoopGroup[]
): { containerId: string | null; order: BuilderEntry[] } | null {
  if (rootOrder.some((e) => e.id === entryId)) return { containerId: null, order: rootOrder }
  for (const g of groups) {
    if (g.children.some((e) => e.id === entryId)) return { containerId: g.id, order: g.children }
  }
  return null
}

/** A loop's nesting depth — a top-level loop is depth 1, root itself is depth 0. */
export function depthOfContainer(containerGroupId: string | null, groups: LoopGroup[]): number {
  return ancestorChain(containerGroupId, groups).length
}

/** A container's full ancestor chain, outermost first (root's is `[]`) — e.g. `[outerLoopId, innerLoopId]` for a step two levels deep. */
export function ancestorChain(containerGroupId: string | null, groups: LoopGroup[]): string[] {
  const byId = new Map(groups.map((g) => [g.id, g]))
  const chain: string[] = []
  let current = containerGroupId
  while (current !== null) {
    chain.unshift(current)
    current = byId.get(current)?.parentGroupId ?? null
  }
  return chain
}

/**
 * Whether `candidateContainerId` is the same container as `targetContainerId`, or one of its
 * ancestors — i.e. whether a step_output reference from `targetContainerId` to a step in
 * `candidateContainerId` has exactly one coherent target clone once iterations are unrolled
 * (see `unrollForExecution`'s truncate-to-common-ancestor remap). A step in an unrelated
 * branch (a sibling loop, or a loop nested under a different ancestor) fails this — there's no
 * single iteration of it that's "the" one a given clone of the referencing step should see.
 */
export function isAncestorOrSameContainer(
  candidateContainerId: string | null,
  targetContainerId: string | null,
  groups: LoopGroup[]
): boolean {
  const candidateChain = ancestorChain(candidateContainerId, groups)
  const targetChain = ancestorChain(targetContainerId, groups)
  if (candidateChain.length > targetChain.length) return false
  return candidateChain.every((id, i) => id === targetChain[i])
}

/** Total step count nested anywhere inside a loop (direct children plus every nested loop's), used for the collapsed step-count badge. */
export function countStepsInGroup(group: LoopGroup, groups: LoopGroup[]): number {
  const groupsById = new Map(groups.map((g) => [g.id, g]))
  let count = 0
  function visit(order: BuilderEntry[]) {
    for (const entry of order) {
      if (entry.kind === 'step') count += 1
      else {
        const g = groupsById.get(entry.id)
        if (g) visit(g.children)
      }
    }
  }
  visit(group.children)
  return count
}

/**
 * Checks whether the currently checked steps are allowed to merge into a new sync group:
 * 2+ selected, none already belonging to a different sync group, all sharing the same
 * immediate parent (Rule 2 — can't sync across different loop-nesting contexts), and
 * currently adjacent within that shared parent's order. Returns `null` when syncing is
 * allowed, or a human-readable reason to show next to a disabled "Sync Selected" control
 * when it isn't. A selection of fewer than 2 is not itself an error — that's the ordinary
 * "select more steps" state, handled separately.
 */
export function validateSyncSelection(
  steps: Step[],
  checkedIds: Set<string>,
  rootOrder: BuilderEntry[],
  groups: LoopGroup[]
): string | null {
  if (checkedIds.size < 2) return null
  const alreadySynced = steps.some((s) => checkedIds.has(s.id) && s.syncGroupId)
  if (alreadySynced) return 'One or more selected steps are already synced — unsync first.'

  const containerIds = [...checkedIds].map((id) => findEntryContainer(id, rootOrder, groups)?.containerId ?? null)
  if (containerIds.some((c) => c !== containerIds[0])) {
    return "Selected steps must share the same parent — can't sync across different loops."
  }

  const containerId = containerIds[0]
  const order = containerId === null ? rootOrder : (groups.find((g) => g.id === containerId)?.children ?? [])
  const indices = order
    .map((entry, idx) => (entry.kind === 'step' && checkedIds.has(entry.id) ? idx : -1))
    .filter((idx) => idx !== -1)
  const isContiguous = indices.every((idx, k) => k === 0 || idx === indices[k - 1] + 1)
  if (!isContiguous) return 'Selected steps must be adjacent to sync.'
  return null
}

/**
 * Checks whether the currently checked steps can be wrapped into a new loop ("Repeat
 * Selected"): 1+ selected, no partial sync-group cut (a synced pair must be wrapped whole or
 * not at all), all sharing the same immediate parent, and currently adjacent within it.
 * Returns `null` when allowed, or a human-readable reason otherwise.
 */
export function validateRepeatSelection(
  steps: Step[],
  checkedIds: Set<string>,
  rootOrder: BuilderEntry[],
  groups: LoopGroup[]
): string | null {
  if (checkedIds.size < 1) return null

  for (const s of steps) {
    if (checkedIds.has(s.id) && s.syncGroupId) {
      const partners = steps.filter((o) => o.syncGroupId === s.syncGroupId)
      if (partners.some((p) => !checkedIds.has(p.id))) {
        return "Can't split a synced pair — select all of its members or none."
      }
    }
  }

  const containerIds = [...checkedIds].map((id) => findEntryContainer(id, rootOrder, groups)?.containerId ?? null)
  if (containerIds.some((c) => c !== containerIds[0])) {
    return 'Selected steps must share the same parent to repeat together.'
  }

  const containerId = containerIds[0]
  const order = containerId === null ? rootOrder : (groups.find((g) => g.id === containerId)?.children ?? [])
  const indices = order
    .map((entry, idx) => (entry.kind === 'step' && checkedIds.has(entry.id) ? idx : -1))
    .filter((idx) => idx !== -1)
  const isContiguous = indices.every((idx, k) => k === 0 || idx === indices[k - 1] + 1)
  if (!isContiguous) return 'Selected steps must be adjacent to repeat together.'
  return null
}

/**
 * Re-checks the invariant "Sync Selected" is supposed to guarantee: every non-null
 * `syncGroupId` in `steps` forms exactly one contiguous run of 2+ members. Used as a
 * server-side backstop on write (see POST /api/pipelines) so a bug in the client, or a
 * future second client, can't persist an invalid grouping — plain data in, no React/DOM
 * dependency, safe to import from a server route. Returns `null` when valid, or a
 * human-readable reason when not.
 */
export function findSyncGroupViolation(steps: { syncGroupId: string | null }[]): string | null {
  const seen = new Set<string>()
  let i = 0
  while (i < steps.length) {
    const gid = steps[i].syncGroupId
    if (!gid) {
      i++
      continue
    }
    if (seen.has(gid)) return `Sync group "${gid}" is not contiguous.`
    seen.add(gid)
    let j = i + 1
    while (j < steps.length && steps[j].syncGroupId === gid) j++
    if (j - i < 2) return `Sync group "${gid}" has fewer than 2 members.`
    i = j
  }
  return null
}

/**
 * Groups a run's flat, ordered `executable` rows into dispatch batches: consecutive rows
 * sharing a non-null `syncGroupId` become one batch, to be started at the same instant; every
 * other row is its own singleton batch. Safe to do by simple adjacency (no container/iteration
 * bookkeeping needed here, unlike `computeContainerUnits`) because `unrollForExecution` already
 * guarantees a synced pair's clones land next to each other in this array and that each loop
 * iteration gets its own fresh `syncGroupId` — so two adjacent rows sharing one never span two
 * iterations or two unrelated groups.
 */
export function groupExecutableBySync(executable: UnrolledStep[]): UnrolledStep[][] {
  const batches: UnrolledStep[][] = []
  let i = 0
  while (i < executable.length) {
    const gid = executable[i].syncGroupId
    if (!gid) {
      batches.push([executable[i]])
      i++
      continue
    }
    const batch = [executable[i]]
    let j = i + 1
    while (j < executable.length && executable[j].syncGroupId === gid) {
      batch.push(executable[j])
      j++
    }
    batches.push(batch)
    i = j
  }
  return batches
}

/** A step's `step_output`-type input keys, resolved via its action's `input_schema`. */
export function stepOutputKeys(
  step: Pick<Step, 'tech' | 'action'>,
  actionsByTech: Partial<Record<TechKey, ActionConfig[]>>
): string[] {
  const action = (actionsByTech[step.tech] ?? []).find((a) => a.key === step.action)
  return (action?.inputs ?? []).filter((i) => i.type === 'step_output').map((i) => i.key)
}

/**
 * Unrolls the builder's tree into what actually gets persisted and executed at Run Pipeline
 * time: `definitions` (exactly one inert row per loop-body step, `iterationPath: null`, never
 * dispatched — mirrors the loop's single definition) and `executable` (every always-real
 * top-level step once, plus `iterationCount` real clones per loop-body step, each tagged with
 * an `iterationPath` — `[i]` at depth 1, `[i,j]` at depth 2, etc., outermost index first).
 *
 * Ids here are still the builder's own (an always-real step's row keeps `def.id` verbatim, only
 * a loop clone gets a fresh one) — deliberately, so live status highlighting during a run
 * (`PipelineBuilder`'s `stepStatus`/`currentStepId`, keyed by these same ids and matched against
 * `steps` state in `ContainerView`) keeps working. What actually gets persisted to
 * `pipeline_steps`/`pipeline_step_groups` is a further-freshened copy of this output — see
 * `freshenRunIds` — since a builder-level step/loop id is otherwise only generated once, at
 * creation, and stays the same across as many "Run Pipeline" clicks as the user makes without
 * touching the builder; replaying it into a second run's insert is a duplicate primary-key error,
 * and since the parent `pipelines` row is already committed by the time that insert fails, that
 * error used to leave the run stuck at `status: 'running'` in History forever.
 *
 * Two things get remapped per clone so nothing inside a cloned block can resolve to a
 * different iteration's clone (or to an inert definition that never runs):
 * - `syncGroupId`: a loop-body synced pair shares one `syncGroupId` at the definition level;
 *   each iteration's clone pair gets its own fresh id, so the orchestrator's simultaneity rule
 *   only ties together the two clones from the *same* iteration, never across iterations.
 * - `step_output`-type input values: resolved via each action's `input_schema` (`actionsByTech`)
 *   and remapped from the referenced definition's id to that reference's own clone at the
 *   *referencing* clone's iteration path, truncated to the referenced step's own nesting depth
 *   (so a loop step referencing something defined in an *enclosing* loop, or at the top level,
 *   correctly resolves to that ancestor's single relevant clone rather than needing its own
 *   per-inner-iteration copy). The step_output picker now only offers same-container-or-ancestor
 *   steps (see StepDraftForm's use of `isAncestorOrSameContainer`), so a reference with no
 *   single coherent target shouldn't be constructible going forward. This fallback (deterministic
 *   first-iteration, with a console warning) is a defensive backstop only — for data that
 *   predates that constraint, or a future bug — not an expected path.
 *
 * `dependsOnStepId` is carried through as `null` on every row — nothing in the builder sets it
 * yet (see UnrolledStep's doc comment) — but the same truncate-to-common-ancestor remap used
 * for step_output is exactly what it would need the moment it's populated.
 */
export function unrollForExecution(
  rootOrder: BuilderEntry[],
  groups: LoopGroup[],
  steps: Step[],
  actionsByTech: Partial<Record<TechKey, ActionConfig[]>>
): { executable: UnrolledStep[]; definitions: UnrolledStep[] } {
  const stepsById = new Map(steps.map((s) => [s.id, s]))
  const groupsById = new Map(groups.map((g) => [g.id, g]))
  const pathKey = (path: number[]) => path.join(',')

  function depthOf(groupId: string | null): number {
    let depth = 0
    let current = groupId
    while (current !== null) {
      depth += 1
      current = groupsById.get(current)?.parentGroupId ?? null
    }
    return depth
  }

  // --- Definitions: exactly one row per loop-body step, un-multiplied, order preserved. ---
  const definitions: UnrolledStep[] = []
  function collectDefinitions(order: BuilderEntry[], insideLoop: boolean) {
    for (const entry of order) {
      if (entry.kind === 'step') {
        if (insideLoop) {
          const def = stepsById.get(entry.id)!
          definitions.push({ ...def, iterationPath: null, dependsOnStepId: null })
        }
      } else {
        const group = groupsById.get(entry.id)!
        collectDefinitions(group.children, true)
      }
    }
  }
  collectDefinitions(rootOrder, false)

  // --- Executable: full expansion, `iterationCount` copies per loop, order preserved. ---
  const cloneIdByOriginalAndPath = new Map<string, Map<string, string>>()
  const executableEntries: { row: UnrolledStep; originalId: string }[] = []

  function expand(order: BuilderEntry[], iterationPrefix: number[]) {
    for (const entry of order) {
      if (entry.kind === 'step') {
        const def = stepsById.get(entry.id)!
        const iterationPath = iterationPrefix.length > 0 ? [...iterationPrefix] : null
        const cloneId = iterationPath ? crypto.randomUUID() : def.id
        let byPath = cloneIdByOriginalAndPath.get(def.id)
        if (!byPath) {
          byPath = new Map()
          cloneIdByOriginalAndPath.set(def.id, byPath)
        }
        byPath.set(pathKey(iterationPrefix), cloneId)
        executableEntries.push({
          originalId: def.id,
          row: { ...def, id: cloneId, iterationPath, dependsOnStepId: null },
        })
      } else {
        const group = groupsById.get(entry.id)!
        for (let i = 1; i <= group.iterationCount; i++) {
          expand(group.children, [...iterationPrefix, i])
        }
      }
    }
  }
  expand(rootOrder, [])

  // --- Remap sync_group_id: fresh id per (originalSyncGroupId, iterationPathKey) — clones only. ---
  const freshSyncId = new Map<string, string>()
  for (const { row } of executableEntries) {
    if (row.iterationPath && row.syncGroupId) {
      const key = `${row.syncGroupId}::${pathKey(row.iterationPath)}`
      let fresh = freshSyncId.get(key)
      if (!fresh) {
        fresh = crypto.randomUUID()
        freshSyncId.set(key, fresh)
      }
      row.syncGroupId = fresh
    }
  }

  // --- Remap step_output references: each clone's reference must resolve to the correct clone. ---
  for (const { row, originalId } of executableEntries) {
    const originalStep = stepsById.get(originalId)!
    for (const key of stepOutputKeys(originalStep, actionsByTech)) {
      const refId = row.inputs[key]
      if (!refId) continue
      const refStep = stepsById.get(refId)
      const refByPath = refStep ? cloneIdByOriginalAndPath.get(refId) : undefined
      if (!refStep || !refByPath) continue // dangling reference (e.g. referenced step since deleted) — leave as-is

      const refDepth = depthOf(refStep.groupId)
      const truncated = (row.iterationPath ?? []).slice(0, refDepth)
      let resolved = refByPath.get(pathKey(truncated))
      if (!resolved) {
        const fallbackPath = Array(refDepth).fill(1)
        resolved = refByPath.get(pathKey(fallbackPath)) ?? refByPath.get('')
        if (resolved) {
          console.warn(
            `step_output reference from step ${row.id} to ${refId} isn't in an ancestor loop context — defaulting to its first iteration.`
          )
        }
      }
      if (resolved) row.inputs = { ...row.inputs, [key]: resolved }
    }
  }

  return { executable: executableEntries.map((e) => e.row), definitions }
}

/**
 * Builds the actual persistence payload from `unrollForExecution`'s output: every step id
 * (executable and definition rows alike) and every loop id gets a brand new uuid, with
 * `groupId`/`parentGroupId`/`dependsOnStepId` and any `step_output`-type `inputs` entries
 * remapped to match. Kept separate from `unrollForExecution` itself (whose ids stay the
 * builder's own) because those builder-space ids are also what live status highlighting
 * during the run keys off of — see `unrollForExecution`'s doc comment — so this remap must
 * happen only in the copy that gets persisted, not the one driving the run's local UI state.
 * Returns `dbIdByRunId`, keyed by the pre-remap (builder-space) step id, so the caller can look
 * up the persisted id for `PATCH /api/pipeline-steps/[id]` calls keyed by that same builder id.
 */
export function freshenRunIds(
  executable: UnrolledStep[],
  definitions: UnrolledStep[],
  groups: { id: string; parentGroupId: string | null; label: string; iterationCount: number }[],
  actionsByTech: Partial<Record<TechKey, ActionConfig[]>>
): { executable: UnrolledStep[]; definitions: UnrolledStep[]; groups: UnrolledGroup[]; dbIdByRunId: Map<string, string> } {
  const stepIdMap = new Map<string, string>()
  for (const s of [...executable, ...definitions]) stepIdMap.set(s.id, crypto.randomUUID())
  const groupIdMap = new Map(groups.map((g) => [g.id, crypto.randomUUID()]))

  function remapStep(s: UnrolledStep): UnrolledStep {
    const inputs = { ...s.inputs }
    for (const key of stepOutputKeys(s, actionsByTech)) {
      const ref = inputs[key]
      if (ref && stepIdMap.has(ref)) inputs[key] = stepIdMap.get(ref)!
    }
    return {
      ...s,
      id: stepIdMap.get(s.id)!,
      groupId: s.groupId ? (groupIdMap.get(s.groupId) ?? s.groupId) : null,
      dependsOnStepId: s.dependsOnStepId ? (stepIdMap.get(s.dependsOnStepId) ?? s.dependsOnStepId) : null,
      inputs,
    }
  }

  return {
    executable: executable.map(remapStep),
    definitions: definitions.map(remapStep),
    groups: groups.map((g) => ({
      id: groupIdMap.get(g.id)!,
      parentGroupId: g.parentGroupId ? (groupIdMap.get(g.parentGroupId) ?? g.parentGroupId) : null,
      label: g.label,
      iterationCount: g.iterationCount,
    })),
    dbIdByRunId: stepIdMap,
  }
}

/**
 * Topologically sorts loop definitions parent-before-child, so a batch insert into
 * `pipeline_step_groups` never violates the self-referencing `parent_group_id` foreign key
 * (a single multi-row INSERT still requires each row's own reference to already be present).
 */
export function sortGroupsParentFirst(groups: UnrolledGroup[]): UnrolledGroup[] {
  const byId = new Map(groups.map((g) => [g.id, g]))
  const sorted: UnrolledGroup[] = []
  const visited = new Set<string>()
  function visit(g: UnrolledGroup) {
    if (visited.has(g.id)) return
    if (g.parentGroupId) {
      const parent = byId.get(g.parentGroupId)
      if (parent) visit(parent)
    }
    visited.add(g.id)
    sorted.push(g)
  }
  for (const g of groups) visit(g)
  return sorted
}

/**
 * Builds the human-readable "Field: value" summary line shown under a step's action/machine.
 * `allSteps` is only needed to resolve a `step_output` input's stored id back to its
 * referenced step's current display number for this label — the id itself is what's stored
 * and never changes, only how it's shown here.
 */
export function summarizeStepInputs(
  step: Step,
  actionsByTech: Partial<Record<TechKey, ActionConfig[]>>,
  allSteps: Step[]
): string {
  const action = (actionsByTech[step.tech] ?? []).find((a) => a.key === step.action)
  if (!action) return ''
  return action.inputs
    .map((inp) => {
      const value = step.inputs[inp.key]
      if (inp.type === 'step_output') {
        if (!value) return ''
        const referenced = allSteps.find((s) => s.id === value)
        return referenced ? `uses output of step ${referenced.num}` : ''
      }
      if (value === undefined || value === '') return ''
      return `${inp.label}: ${value}`
    })
    .filter(Boolean)
    .join(' · ')
}
