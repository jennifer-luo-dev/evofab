// usePipelineBuilder.ts
// Encapsulates all pipeline-step state and mutations for the Pipelines page:
// adding/editing/deleting steps, reordering them, and grouping two or more
// into a "synced" unit that runs simultaneously. Keeps PipelineBuilder and
// its children focused on rendering rather than state management.

import { useMemo, useRef, useState } from 'react'
import { actionsForTech, usePipelineConfig } from './PipelineConfigContext'
import { computeUnits, renumberSteps } from './pipelineUtils'
import type { PipelineConfig } from './PipelineConfigContext'
import type { DraftMode, Step, StepDraft, TechKey } from './types'

/** Builds a fresh draft for a new step, defaulting to the first available technology and its first action. */
function newDraft(availableTechs: TechKey[], config: PipelineConfig): StepDraft {
  const tech = availableTechs[0] ?? 'printer'
  const action = actionsForTech(config, tech)[0]?.key ?? ''
  return { tech, action, machine: '', inputs: {} }
}

/** Owns the pipeline builder's step list, sync grouping, and add/edit draft form state. */
export function usePipelineBuilder(availableTechs: TechKey[]) {
  const config = usePipelineConfig()
  const [steps, setSteps] = useState<Step[]>([])
  const [checkedIds, setCheckedIds] = useState<Set<number>>(new Set())
  const [draftMode, setDraftMode] = useState<DraftMode>(null)
  const [draftState, setDraftState] = useState<StepDraft | null>(null)
  const [draftError, setDraftError] = useState<string | null>(null)
  const idCounter = useRef(1)
  const groupCounter = useRef(1)

  const units = useMemo(() => computeUnits(steps), [steps])

  /** Reorders the unit at `unitIdx` by `dir` (-1 up, +1 down) and renumbers. */
  function moveUnit(unitIdx: number, dir: -1 | 1) {
    const target = unitIdx + dir
    if (target < 0 || target >= units.length) return
    const reordered = [...units]
    ;[reordered[unitIdx], reordered[target]] = [reordered[target], reordered[unitIdx]]
    setSteps(renumberSteps(reordered.flat()))
  }

  /** Removes a step; if that leaves a sync group with only one member, ungroups it. */
  function deleteStep(id: number) {
    const removed = steps.find((s) => s.id === id)
    let next = steps.filter((s) => s.id !== id)
    if (removed?.syncGroupId) {
      const remaining = next.filter((s) => s.syncGroupId === removed.syncGroupId)
      if (remaining.length === 1) {
        next = next.map((s) => (s.id === remaining[0].id ? { ...s, syncGroupId: null } : s))
      }
    }
    setSteps(renumberSteps(next))
    setCheckedIds((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }

  /** Toggles a step's checkbox, used to select two or more steps to sync together. */
  function toggleChecked(id: number) {
    setCheckedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  /** Groups the currently checked steps (must be 2+) into a new sync group, preserving their relative order. */
  function syncSelected() {
    if (checkedIds.size < 2) return
    const gid = `g${groupCounter.current++}`
    const selected = steps.filter((s) => checkedIds.has(s.id))
    const rest = steps.filter((s) => !checkedIds.has(s.id))
    const firstIdx = steps.findIndex((s) => checkedIds.has(s.id))
    const insertAt = steps.slice(0, firstIdx).filter((s) => !checkedIds.has(s.id)).length
    const grouped = selected.map((s) => ({ ...s, syncGroupId: gid }))
    const next = [...rest.slice(0, insertAt), ...grouped, ...rest.slice(insertAt)]
    setSteps(renumberSteps(next))
    setCheckedIds(new Set())
  }

  /** Ungroups every step in the given sync group back into independent steps. */
  function unsyncGroup(groupId: string) {
    setSteps(
      renumberSteps(steps.map((s) => (s.syncGroupId === groupId ? { ...s, syncGroupId: null } : s)))
    )
  }

  /** Opens the draft form: a blank draft when `editId` is omitted, or the given step's values when editing. */
  function openDraft(editId?: number) {
    if (editId !== undefined) {
      const existing = steps.find((s) => s.id === editId)
      if (!existing) return
      setDraftState({
        id: existing.id,
        tech: existing.tech,
        action: existing.action,
        machine: existing.machine,
        inputs: { ...existing.inputs },
      })
      setDraftMode('edit')
    } else {
      setDraftState(newDraft(availableTechs, config))
      setDraftMode('add')
    }
    setDraftError(null)
  }

  function closeDraft() {
    setDraftMode(null)
    setDraftState(null)
    setDraftError(null)
  }

  /** Switching technology resets the action, machine, and inputs, since they're tech-specific. */
  function changeDraftTech(tech: TechKey) {
    setDraftState((prev) =>
      prev
        ? { ...prev, tech, action: actionsForTech(config, tech)[0]?.key ?? '', machine: '', inputs: {} }
        : prev
    )
  }

  function changeDraftAction(action: string) {
    setDraftState((prev) => (prev ? { ...prev, action } : prev))
  }

  function changeDraftMachine(machine: string) {
    setDraftState((prev) => (prev ? { ...prev, machine } : prev))
  }

  function setDraftInput(key: string, value: string) {
    setDraftState((prev) => (prev ? { ...prev, inputs: { ...prev.inputs, [key]: value } } : prev))
  }

  /** Validates and commits the current draft as a new step or an update to the step it's editing. */
  function commitDraft() {
    if (!draftState) return
    if (!draftState.machine) {
      setDraftError('Select a machine before adding this step.')
      return
    }
    if (draftMode === 'edit' && draftState.id !== undefined) {
      setSteps((prev) =>
        renumberSteps(
          prev.map((s) =>
            s.id === draftState.id
              ? {
                  ...s,
                  tech: draftState.tech,
                  action: draftState.action,
                  machine: draftState.machine,
                  inputs: { ...draftState.inputs },
                }
              : s
          )
        )
      )
    } else {
      const step: Step = {
        id: idCounter.current++,
        tech: draftState.tech,
        action: draftState.action,
        machine: draftState.machine,
        inputs: { ...draftState.inputs },
        syncGroupId: null,
        num: 0,
      }
      setSteps((prev) => renumberSteps([...prev, step]))
    }
    closeDraft()
  }

  return {
    steps,
    units,
    checkedIds,
    toggleChecked,
    syncSelected,
    unsyncGroup,
    moveUnit,
    deleteStep,
    draftMode,
    draftState,
    draftError,
    openDraft,
    closeDraft,
    changeDraftTech,
    changeDraftAction,
    changeDraftMachine,
    setDraftInput,
    commitDraft,
  }
}
