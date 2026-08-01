// types.ts (history)
// UI types for the History page's pipeline run list and detail view, wired
// to `pipelines`/`pipeline_steps` (see evofab-app/supabase/schema.sql) via
// /api/pipelines.

import type { TechKey } from '@/app/components/pipelines/types'
import type { MoveTargetBody } from '@/app/lib/robot'
import type { PrinterStatus } from '@/app/types/printer'

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
  /** Photo produced by the step (camera's `image_keys[0]` or classification_model's annotated `image_url`), if any — shown as a thumbnail instead of `result`'s text. */
  imageUrl?: string | null
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

/**
 * Live telemetry `machine_status.telemetry` may carry for the machine — a full `PrinterStatus`
 * snapshot as of `syncMachineStatus` in `/api/printers`, the only writer today. Optional since
 * non-printer machines never populate it.
 */
export type MachineTelemetry = Partial<PrinterStatus>

/** One row in the detail view's machine status side panel. */
export interface MachineStatusRow {
  name: string
  state: string
  dotColorClass: string
  telemetry?: MachineTelemetry
}

/**
 * The step a persisted run is currently executing, if any — the History-page counterpart to
 * PipelineBuilder's `RunningStepState`, but reconstructed from polled DB/telemetry data rather
 * than an executing tab's local state, so it's visible from any tab. `printer_status` and
 * `streamUrl` come from `machine_status.telemetry` and a live Moonraker webcam-list lookup;
 * `target` is parsed server-side from the step's persisted `inputs`; `sourceImageUrl` is read
 * from the referenced camera step's persisted `outputs`.
 */
export type LiveStep =
  | { tech: 'printer'; label: string; machine: string; streamUrl: string | null; printerStatus: PrinterStatus | null }
  | { tech: 'robot_arm'; label: string; machine: string; target: MoveTargetBody | null }
  | { tech: 'camera'; label: string; machine: string }
  | { tech: 'classification_model'; label: string; machine: string; sourceImageUrl: string | null }
