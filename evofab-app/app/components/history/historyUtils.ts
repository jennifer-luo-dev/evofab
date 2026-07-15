// historyUtils.ts
// Pure helpers for grouping a pipeline run's progress steps, mirroring
// pipelineUtils.ts's computeUnits but over ProgressStep's `group` field
// rather than a Step's `syncGroupId`.

import type { ProgressStep } from './types'

/** Groups consecutive progress steps that share a `group` value into synced units. */
export function computeProgressUnits(steps: ProgressStep[]): ProgressStep[][] {
  const units: ProgressStep[][] = []
  let i = 0
  while (i < steps.length) {
    const step = steps[i]
    if (step.group) {
      const group = [step]
      let j = i + 1
      while (j < steps.length && steps[j].group === step.group) {
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
