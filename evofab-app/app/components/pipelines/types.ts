// types.ts (pipelines)
// UI types for the Pipelines page's technology selection and pipeline
// builder. `TechOption`/`ActionConfig` are sourced from `machine_types`/
// `action_types` via /api/machine-types and /api/action-types; `Step`/
// `StepDraft` remain local-only builder state (not yet persisted to
// `pipelines`/`pipeline_steps` — see evofab-app/supabase/schema.sql).

/**
 * A machine type's `type_key` (see `machine_types.type_key` in
 * evofab-app/supabase/schema.sql) — free-form lowercase snake_case, not a
 * closed set. Any machine type without a dedicated pipeline action (e.g. a
 * load cell) simply never appears in `/api/action-types`'s response.
 */
export type TechKey = string

/** A technology entry shown in the technology-selection grid. `machine_types` has no description column, so `desc` is only shown when present. */
export interface TechOption {
  key: TechKey
  name: string
  desc?: string
}

/** One configurable input on a step action (e.g. a print file path, a repeat count). */
export interface StepInputConfig {
  key: string
  label: string
  type: 'text' | 'number' | 'select' | 'file' | 'step_output'
  default?: string | number
  options?: string[]
  /** `type: 'select'` only — a lookup table to source options from, when `options` isn't a static list (e.g. `"print_profiles"`). */
  source?: string
  /** `type: 'step_output'` only — the output `type` (see `StepOutputConfig`) a candidate step must produce to be selectable. */
  expects?: string
}

/** One output an action produces, referenceable by a later step's `step_output` input. */
export interface StepOutputConfig {
  key: string
  label: string
  type: string
  options?: string[]
}

/** An action a technology can perform as a pipeline step (e.g. Printer -> Print). */
export interface ActionConfig {
  key: string
  label: string
  inputs: StepInputConfig[]
  outputs: StepOutputConfig[]
}

/** A single step in the pipeline being built. `syncGroupId` links steps meant to run simultaneously. */
export interface Step {
  id: number
  tech: TechKey
  action: string
  machine: string
  inputs: Record<string, string>
  syncGroupId: string | null
  /** Display order — shared across all steps in the same sync group. Recomputed by `renumberSteps`. */
  num: number
}

/** In-progress add/edit form state for a step, before it's committed into `steps`. */
export interface StepDraft {
  id?: number
  tech: TechKey
  action: string
  machine: string
  inputs: Record<string, string>
}

/** `'add'` while creating a new step, `'edit'` while editing an existing one, `null` when the draft form is closed. */
export type DraftMode = 'add' | 'edit' | null
