// types.ts (history)
// UI types for the History page's pipeline run list and detail view, wired
// to `pipelines`/`pipeline_steps` (see evofab-app/supabase/schema.sql) via
// /api/pipelines.

import type { TechKey } from '@/app/components/pipelines/types'

/**
 * Status of a pipeline run or an individual step within it. The union of
 * `pipelines.status` and `pipeline_steps.status`'s CHECK constraints — a run
 * only ever reports the former, a step only the latter.
 */
export type PipelineRunStatus =
  | 'draft'
  | 'pending'
  | 'queued'
  | 'waiting_dependency'
  | 'running'
  | 'complete'
  | 'failed'
  | 'skipped'
  | 'aborted'

/** One row in the pipeline run list. */
export interface PipelineSummary {
  id: string
  name: string
  date: string
  status: PipelineRunStatus
  steps: number
}

/** One row in a run's results table. */
export interface ResultRow {
  type: string
  ts: string
  result: string
}

/** One step in a run's progress tracker. Steps sharing `group` ran simultaneously. */
export interface ProgressStep {
  num: number
  tech: TechKey
  label: string
  machine: string
  status: PipelineRunStatus
  group?: string
}

/** One row in the detail view's machine status side panel. */
export interface MachineStatusRow {
  name: string
  state: string
  dotColorClass: string
}
