// pipelineUtils.ts
// Pure helper functions for grouping and describing pipeline steps, shared
// by the builder (usePipelineBuilder) and the read-only progress view on the
// History page.

import type { ActionConfig, Step, TechKey } from './types'

/** Groups consecutive steps that share a `syncGroupId` into "units" — the unit is what gets a single display number. */
export function computeUnits(steps: Step[]): Step[][] {
  const units: Step[][] = []
  let i = 0
  while (i < steps.length) {
    const step = steps[i]
    if (step.syncGroupId) {
      const group = [step]
      let j = i + 1
      while (j < steps.length && steps[j].syncGroupId === step.syncGroupId) {
        group.push(steps[j])
        j++
      }
      units.push(group)
      i = j
    } else {
      units.push([step])
      i++
    }
  }
  return units
}

/** Assigns `num` to every step based on its unit's position, so synced steps share one display number. */
export function renumberSteps(steps: Step[]): Step[] {
  const units = computeUnits(steps)
  const numbered = steps.map((s) => ({ ...s }))
  units.forEach((unit, idx) => {
    for (const step of unit) {
      const target = numbered.find((s) => s.id === step.id)
      if (target) target.num = idx + 1
    }
  })
  return numbered
}

/** Builds the human-readable "Field: value" summary line shown under a step's action/machine. */
export function summarizeStepInputs(
  step: Step,
  actionsByTech: Partial<Record<TechKey, ActionConfig[]>>
): string {
  const action = (actionsByTech[step.tech] ?? []).find((a) => a.key === step.action)
  if (!action) return ''
  return action.inputs
    .map((inp) => {
      const value = step.inputs[inp.key]
      if (inp.type === 'step_output') return value ? `uses output of step ${value}` : ''
      if (value === undefined || value === '') return ''
      return `${inp.label}: ${value}`
    })
    .filter(Boolean)
    .join(' · ')
}
