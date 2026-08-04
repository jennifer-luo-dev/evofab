// usePipelineBuilder.ts
// Encapsulates all pipeline-builder state and mutations for the Pipelines
// page: adding/editing/deleting steps, reordering, grouping two or more
// steps into a "synced" unit, and nesting steps inside loops. Keeps
// PipelineBuilder and its children focused on rendering rather than state
// management.
//
// Structure: `rootOrder` (top-level) and each `LoopGroup.children` are
// authoritative for both order and containment — a container is an ordered
// list of `BuilderEntry` references (step ids and/or nested loop ids).
// `steps`/`groups` are flat content bags; `Step.num`/`Step.groupId` are
// derived projections of the tree, recomputed by `commit()` after every
// mutation (see pipelineUtils.deriveStepFields). This is all client-state
// only until "Run Pipeline," same as every other step edit today — eager
// per-mutation persistence is separate, out-of-scope follow-up work.

import { useMemo, useRef, useState } from 'react'
import { actionsForTech, usePipelineConfig } from './PipelineConfigContext'
import {
  computeContainerUnits,
  deriveStepFields,
  findEntryContainer,
  validateRepeatSelection,
  validateSyncSelection,
} from './pipelineUtils'
import { DEFAULT_SETTINGS } from '@/app/contexts/PrinterContext'
import type { PipelineConfig } from './PipelineConfigContext'
import type { ActionConfig, BuilderEntry, DraftMode, LoopGroup, Step, StepDraft, TechKey } from './types'
import type { MaterialProfile, PrintSettings } from '@/app/types/job'

/**
 * Seeds a draft's `inputs` from an action's schema so the value shown in the form
 * (DraftInputField falls back to `input.default`, or a `select`'s first option, when
 * the draft has nothing set) is actually what gets committed if the user never
 * touches the field — otherwise a step can silently commit with empty inputs.
 */
function defaultInputs(action?: ActionConfig): Record<string, string> {
  const result: Record<string, string> = {}
  for (const input of action?.inputs ?? []) {
    if (input.default !== undefined) result[input.key] = String(input.default)
    else if (input.type === 'select' && input.options?.length) result[input.key] = input.options[0]
  }
  return result
}

/** Builds a fresh draft for a new step, defaulting to the first available technology and its first action. */
function newDraft(availableTechs: TechKey[], config: PipelineConfig): StepDraft {
  const tech = availableTechs[0] ?? 'printer'
  const action = actionsForTech(config, tech)[0]
  return {
    tech,
    action: action?.key ?? '',
    machine: '',
    inputs: defaultInputs(action),
    files: {},
    printSettings: { ...DEFAULT_SETTINGS },
    materialProfileId: null,
  }
}

/** Owns the pipeline builder's step/loop tree, sync grouping, and add/edit draft form state. */
export function usePipelineBuilder(availableTechs: TechKey[]) {
  const config = usePipelineConfig()
  const [steps, setSteps] = useState<Step[]>([])
  const [groups, setGroups] = useState<LoopGroup[]>([])
  const [rootOrder, setRootOrder] = useState<BuilderEntry[]>([])
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set())
  const [draftMode, setDraftMode] = useState<DraftMode>(null)
  const [draftState, setDraftState] = useState<StepDraft | null>(null)
  const [draftError, setDraftError] = useState<string | null>(null)
  /** Which container a new step (add mode only) is being added into — `null` is root. */
  const [draftTargetGroupId, setDraftTargetGroupId] = useState<string | null>(null)
  const groupCounter = useRef(1)

  /** Null when the current checked selection is syncable; otherwise the reason it isn't — see `validateSyncSelection`. */
  const syncError = useMemo(
    () => validateSyncSelection(steps, checkedIds, rootOrder, groups),
    [steps, checkedIds, rootOrder, groups]
  )
  /** Null when the current checked selection can be wrapped into a new loop; otherwise the reason it can't — see `validateRepeatSelection`. */
  const repeatError = useMemo(
    () => validateRepeatSelection(steps, checkedIds, rootOrder, groups),
    [steps, checkedIds, rootOrder, groups]
  )

  /** Single choke point for every mutation: re-derives `num`/`groupId` from the (possibly new) tree shape before committing state. */
  function commit(nextRootOrder: BuilderEntry[], nextGroups: LoopGroup[], nextStepsRaw: Step[]) {
    setRootOrder(nextRootOrder)
    setGroups(nextGroups)
    setSteps(deriveStepFields(nextStepsRaw, nextRootOrder, nextGroups))
  }

  /**
   * Replaces the whole tree wholesale — used to hydrate the builder from a past run's
   * reconstructed definition (see GET /api/pipelines/[id]/definition and "Edit & Rerun" in
   * PipelineBuilder), the one case where a tree arrives fully-formed rather than being built up
   * through the usual step-at-a-time mutations. Also clears any in-progress selection/draft,
   * since both refer to ids from whatever tree was there before.
   */
  function loadDefinition(nextSteps: Step[], nextGroups: LoopGroup[], nextRootOrder: BuilderEntry[]) {
    commit(nextRootOrder, nextGroups, nextSteps)
    setCheckedIds(new Set())
    closeDraft()
  }

  function orderOf(containerGroupId: string | null, groupsList: LoopGroup[]): BuilderEntry[] {
    if (containerGroupId === null) return rootOrder
    return groupsList.find((g) => g.id === containerGroupId)?.children ?? []
  }

  function withOrder(containerGroupId: string | null, groupsList: LoopGroup[], nextOrder: BuilderEntry[]) {
    if (containerGroupId === null) return { rootOrder: nextOrder, groups: groupsList }
    return {
      rootOrder,
      groups: groupsList.map((g) => (g.id === containerGroupId ? { ...g, children: nextOrder } : g)),
    }
  }

  /** Reorders the unit at `unitIdx` within the given container by `dir` (-1 up, +1 down) — a sync pair or a whole loop moves as one atomic block. */
  function moveEntry(containerGroupId: string | null, unitIdx: number, dir: -1 | 1) {
    const order = orderOf(containerGroupId, groups)
    const stepsById = new Map(steps.map((s) => [s.id, s]))
    const units = computeContainerUnits(order, stepsById)
    const target = unitIdx + dir
    if (target < 0 || target >= units.length) return
    const reordered = [...units]
    ;[reordered[unitIdx], reordered[target]] = [reordered[target], reordered[unitIdx]]
    const next = withOrder(containerGroupId, groups, reordered.flat())
    commit(next.rootOrder, next.groups, steps)
  }

  /**
   * Removes a step; if that leaves a sync group with only one member, ungroups it. If removing
   * it empties its containing loop entirely (no steps, no nested loops left), that loop is
   * auto-deleted too — mirroring sync's auto-dissolve — cascading upward if that empties its
   * own parent loop in turn.
   */
  function deleteStep(id: string) {
    const removed = steps.find((s) => s.id === id)
    let nextSteps = steps.filter((s) => s.id !== id)
    if (removed?.syncGroupId) {
      const remaining = nextSteps.filter((s) => s.syncGroupId === removed.syncGroupId)
      if (remaining.length === 1) {
        nextSteps = nextSteps.map((s) => (s.id === remaining[0].id ? { ...s, syncGroupId: null } : s))
      }
    }

    let nextRootOrder = rootOrder
    let nextGroups = groups
    const container = findEntryContainer(id, rootOrder, groups)
    let cursor = container?.containerId ?? null
    const strippedOrder = (container?.order ?? rootOrder).filter((e) => !(e.kind === 'step' && e.id === id))
    ;({ rootOrder: nextRootOrder, groups: nextGroups } = withOrder(cursor, nextGroups, strippedOrder))

    // Cascade: if that emptied a loop, delete it too, and check its parent in turn.
    while (cursor !== null) {
      const group = nextGroups.find((g) => g.id === cursor)
      if (!group || group.children.length > 0) break
      const parentId = group.parentGroupId
      nextGroups = nextGroups.filter((g) => g.id !== cursor)
      const parentOrder = (parentId === null ? nextRootOrder : (nextGroups.find((g) => g.id === parentId)?.children ?? []))
        .filter((e) => !(e.kind === 'loop' && e.id === cursor))
      ;({ rootOrder: nextRootOrder, groups: nextGroups } = withOrder(parentId, nextGroups, parentOrder))
      cursor = parentId
    }

    commit(nextRootOrder, nextGroups, nextSteps)
    setCheckedIds((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }

  /** Toggles a step's checkbox, used to select steps to sync (2+) or wrap in a loop (1+). */
  function toggleChecked(id: string) {
    setCheckedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  /**
   * Groups the currently checked steps into a new sync group. Adjacency and same-parent are
   * already guaranteed by `syncError` being null, so this only needs to tag them — no
   * structural reordering required. A no-op if the selection is invalid — the UI is expected
   * to disable the triggering control in that case, this is just the defensive backstop.
   */
  function syncSelected() {
    if (checkedIds.size < 2 || syncError) return
    const gid = `g${groupCounter.current++}`
    const nextSteps = steps.map((s) => (checkedIds.has(s.id) ? { ...s, syncGroupId: gid } : s))
    commit(rootOrder, groups, nextSteps)
    setCheckedIds(new Set())
  }

  /** Ungroups every step in the given sync group back into independent steps. */
  function unsyncGroup(groupId: string) {
    const nextSteps = steps.map((s) => (s.syncGroupId === groupId ? { ...s, syncGroupId: null } : s))
    commit(rootOrder, groups, nextSteps)
  }

  /**
   * Wraps the currently checked steps in a brand-new loop, preserving their relative order.
   * A no-op if the selection is invalid (see `repeatError`).
   */
  function repeatSelected(iterationCount: number) {
    if (checkedIds.size < 1 || repeatError) return
    const containerId = findEntryContainer([...checkedIds][0], rootOrder, groups)?.containerId ?? null
    const order = orderOf(containerId, groups)
    const indices = order
      .map((entry, idx) => (entry.kind === 'step' && checkedIds.has(entry.id) ? idx : -1))
      .filter((idx) => idx !== -1)
    if (indices.length === 0) return
    const first = indices[0]
    const last = indices[indices.length - 1]
    const wrapped = order.slice(first, last + 1)

    const newGroupId = crypto.randomUUID()
    const newGroup: LoopGroup = {
      id: newGroupId,
      parentGroupId: containerId,
      label: '',
      iterationCount,
      children: wrapped,
    }
    const nextOrder = [...order.slice(0, first), { kind: 'loop' as const, id: newGroupId }, ...order.slice(last + 1)]
    const next = withOrder(containerId, [...groups, newGroup], nextOrder)
    commit(next.rootOrder, next.groups, steps)
    setCheckedIds(new Set())
  }

  /** Creates a new, empty loop inside the given container (`null` = top-level) and appends it. */
  function addLoop(containerGroupId: string | null, iterationCount: number, label = '') {
    const newGroup: LoopGroup = {
      id: crypto.randomUUID(),
      parentGroupId: containerGroupId,
      label,
      iterationCount,
      children: [],
    }
    const order = [...orderOf(containerGroupId, groups), { kind: 'loop' as const, id: newGroup.id }]
    const next = withOrder(containerGroupId, [...groups, newGroup], order)
    commit(next.rootOrder, next.groups, steps)
  }

  function updateLoopIterationCount(groupId: string, iterationCount: number) {
    if (iterationCount < 2) return
    setGroups((prev) => prev.map((g) => (g.id === groupId ? { ...g, iterationCount } : g)))
  }

  function updateLoopLabel(groupId: string, label: string) {
    setGroups((prev) => prev.map((g) => (g.id === groupId ? { ...g, label } : g)))
  }

  /** Deletes a loop and everything defined inside it (steps and nested loops), recursively. */
  function deleteLoop(groupId: string) {
    const groupsById = new Map(groups.map((g) => [g.id, g]))
    const target = groupsById.get(groupId)
    if (!target) return

    const removedGroupIds = new Set<string>([groupId])
    const removedStepIds = new Set<string>()
    function collect(order: BuilderEntry[]) {
      for (const entry of order) {
        if (entry.kind === 'step') removedStepIds.add(entry.id)
        else {
          removedGroupIds.add(entry.id)
          const g = groupsById.get(entry.id)
          if (g) collect(g.children)
        }
      }
    }
    collect(target.children)

    const nextSteps = steps.filter((s) => !removedStepIds.has(s.id))
    const nextGroups = groups.filter((g) => !removedGroupIds.has(g.id))
    const parentOrder = orderOf(target.parentGroupId, groups).filter((e) => !(e.kind === 'loop' && e.id === groupId))
    const next = withOrder(target.parentGroupId, nextGroups, parentOrder)
    commit(next.rootOrder, next.groups, nextSteps)
    setCheckedIds((prev) => {
      const next = new Set(prev)
      for (const id of removedStepIds) next.delete(id)
      return next
    })
  }

  /** Opens the draft form: a blank draft when `editId` is omitted, or the given step's values when editing. `targetGroupId` scopes a new step into that loop's body (`null` = top-level); ignored when editing, since editing never moves a step between containers. */
  function openDraft(editId?: string, targetGroupId: string | null = null) {
    if (editId !== undefined) {
      const existing = steps.find((s) => s.id === editId)
      if (!existing) return
      setDraftState({
        id: existing.id,
        tech: existing.tech,
        action: existing.action,
        machine: existing.machine,
        inputs: { ...existing.inputs },
        files: { ...(existing.files ?? {}) },
        printSettings: { ...(existing.printSettings ?? DEFAULT_SETTINGS) },
        materialProfileId: existing.materialProfileId ?? null,
      })
      setDraftMode('edit')
    } else {
      setDraftState(newDraft(availableTechs, config))
      setDraftMode('add')
      setDraftTargetGroupId(targetGroupId)
    }
    setDraftError(null)
  }

  function closeDraft() {
    setDraftMode(null)
    setDraftState(null)
    setDraftError(null)
    setDraftTargetGroupId(null)
  }

  /** Switching technology resets the action, machine, and inputs, since they're tech-specific. */
  function changeDraftTech(tech: TechKey) {
    setDraftState((prev) => {
      if (!prev) return prev
      const action = actionsForTech(config, tech)[0]
      return {
        ...prev,
        tech,
        action: action?.key ?? '',
        machine: '',
        inputs: defaultInputs(action),
        files: {},
        printSettings: { ...DEFAULT_SETTINGS },
        materialProfileId: null,
      }
    })
  }

  /** Switching actions resets inputs to the new action's schema defaults — a different action can have a completely different input schema, so stale values from the old one shouldn't linger. */
  function changeDraftAction(action: string) {
    setDraftState((prev) => {
      if (!prev) return prev
      const actionConfig = actionsForTech(config, prev.tech).find((a) => a.key === action)
      return { ...prev, action, inputs: defaultInputs(actionConfig) }
    })
  }

  function changeDraftMachine(machine: string) {
    setDraftState((prev) => (prev ? { ...prev, machine } : prev))
  }

  function setDraftInput(key: string, value: string) {
    setDraftState((prev) => (prev ? { ...prev, inputs: { ...prev.inputs, [key]: value } } : prev))
  }

  /** Sets or clears the File object backing a `type: 'file'` input. */
  function setDraftFile(key: string, file: File | null) {
    setDraftState((prev) => {
      if (!prev) return prev
      const files = { ...(prev.files ?? {}) }
      if (file) files[key] = file
      else delete files[key]
      return { ...prev, files }
    })
  }

  function setDraftPrintSetting(key: keyof PrintSettings, value: number) {
    setDraftState((prev) =>
      prev
        ? { ...prev, printSettings: { ...(prev.printSettings ?? DEFAULT_SETTINGS), [key]: value } }
        : prev
    )
  }

  /** Selecting a material profile overwrites the draft's print settings with that profile's values, mirroring PrinterContext. */
  function setDraftMaterialProfile(profile: MaterialProfile | null) {
    setDraftState((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        materialProfileId: profile?.id ?? null,
        printSettings: profile
          ? {
              nozzle_temp: profile.nozzle_temp,
              bed_temp: profile.bed_temp,
              speed: profile.speed,
              flow_rate: profile.flow_rate,
              fan_speed: profile.fan_speed,
            }
          : prev.printSettings,
      }
    })
  }

  /** Validates and commits the current draft as a new step (into `draftTargetGroupId`) or an update to the step it's editing. */
  function commitDraft() {
    if (!draftState) return
    if (!draftState.machine) {
      setDraftError('Select a machine before adding this step.')
      return
    }
    if (draftMode === 'edit' && draftState.id !== undefined) {
      const nextSteps = steps.map((s) =>
        s.id === draftState.id
          ? {
              ...s,
              tech: draftState.tech,
              action: draftState.action,
              machine: draftState.machine,
              inputs: { ...draftState.inputs },
              files: { ...(draftState.files ?? {}) },
              printSettings: draftState.printSettings,
              materialProfileId: draftState.materialProfileId ?? null,
            }
          : s
      )
      commit(rootOrder, groups, nextSteps)
    } else {
      const step: Step = {
        id: crypto.randomUUID(),
        tech: draftState.tech,
        action: draftState.action,
        machine: draftState.machine,
        inputs: { ...draftState.inputs },
        files: { ...(draftState.files ?? {}) },
        printSettings: draftState.printSettings,
        materialProfileId: draftState.materialProfileId ?? null,
        syncGroupId: null,
        num: 0,
        groupId: draftTargetGroupId,
      }
      const order = [...orderOf(draftTargetGroupId, groups), { kind: 'step' as const, id: step.id }]
      const next = withOrder(draftTargetGroupId, groups, order)
      commit(next.rootOrder, next.groups, [...steps, step])
    }
    closeDraft()
  }

  return {
    steps,
    groups,
    rootOrder,
    checkedIds,
    toggleChecked,
    syncSelected,
    syncError,
    unsyncGroup,
    repeatSelected,
    repeatError,
    addLoop,
    updateLoopIterationCount,
    updateLoopLabel,
    deleteLoop,
    moveEntry,
    deleteStep,
    draftMode,
    draftState,
    draftError,
    draftTargetGroupId,
    openDraft,
    closeDraft,
    changeDraftTech,
    changeDraftAction,
    changeDraftMachine,
    setDraftInput,
    setDraftFile,
    setDraftPrintSetting,
    setDraftMaterialProfile,
    commitDraft,
    loadDefinition,
  }
}
