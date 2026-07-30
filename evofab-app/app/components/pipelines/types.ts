// types.ts (pipelines)
// UI types for the Pipelines page's technology selection and pipeline
// builder. `TechOption`/`ActionConfig` are sourced from `machine_types`/
// `action_types` via /api/machine-types and /api/action-types; `Step`/
// `StepDraft` are local-only builder state. When Run Pipeline starts, the
// current step list is persisted to `pipelines`/`pipeline_steps` (see
// evofab-app/supabase/schema.sql) via POST /api/pipelines — see
// PipelineBuilder.runPipeline().

/**
 * A machine type's `type_key` (see `machine_types.type_key` in
 * evofab-app/supabase/schema.sql) — free-form lowercase snake_case, not a
 * closed set. Any machine type without a dedicated pipeline action (e.g. a
 * load cell) simply never appears in `/api/action-types`'s response.
 */
import type { PrintSettings } from '@/app/types/job'

export type TechKey = string

/** A technology entry shown in the technology-selection grid. `machine_types` has no description column, so `desc` is only shown when present. */
export interface TechOption {
  /** `machine_types.id` — needed to persist a run's steps to `pipeline_steps.machine_type_id`. */
  id: string
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
  /** `action_types.id` — needed to persist a run's steps to `pipeline_steps.action_type_id`. */
  id: string
  key: string
  label: string
  inputs: StepInputConfig[]
  outputs: StepOutputConfig[]
}

/** A single step in the pipeline being built. `syncGroupId` links steps meant to run simultaneously. */
export interface Step {
  /**
   * Client-generated `crypto.randomUUID()`, reused verbatim as `pipeline_steps.id` when the
   * step is persisted — so a `step_output` input can store this id as its value from the
   * moment the step is created and never needs remapping once it hits the database. Never
   * the step's display position (`num`), which is recomputed on every reorder.
   */
  id: string
  tech: TechKey
  action: string
  machine: string
  inputs: Record<string, string>
  /** Actual File objects for this step's `type: 'file'` inputs, keyed by input key — not serializable, so kept out of `inputs`. */
  files?: Record<string, File>
  /** Printer-specific print settings, set via the embedded PrintSettingsPanel when `tech === 'printer'`. */
  printSettings?: PrintSettings
  materialProfileId?: string | null
  syncGroupId: string | null
  /**
   * Global sequential display position across the whole pipeline (loop bodies included, no
   * per-loop restart) — derived, not authoritative. Recomputed by `deriveStepFields` from the
   * tree structure (`rootOrder`/`LoopGroup.children`) after every mutation.
   */
  num: number
  /**
   * The immediate loop this step's definition belongs to, or `null` for a top-level step —
   * derived from the tree structure by `deriveStepFields`, mirroring `pipeline_steps.group_id`.
   * Not itself authoritative: which container an entry lives in is determined by which
   * container's order array (`rootOrder` or a `LoopGroup.children`) references its id.
   */
  groupId: string | null
}

/**
 * A loop body definition — mirrors a `pipeline_step_groups` row. `children` is this loop's own
 * ordered list of direct members (steps and/or nested loops); `parentGroupId` is `null` for a
 * top-level loop. Exactly one `LoopGroup` per loop regardless of `iterationCount` — iterations
 * aren't enumerated in the builder (see pipeline-features-breakdown.md).
 */
export interface LoopGroup {
  id: string
  parentGroupId: string | null
  label: string
  iterationCount: number
  children: BuilderEntry[]
}

/**
 * One child reference within a container's ordered list (the root pipeline, or a loop's
 * `children`) — either a step or a nested loop. Order/containment is authoritative here; `Step.
 * groupId` and `Step.num` are just cached projections of it for display/persistence convenience.
 */
export type BuilderEntry = { kind: 'step'; id: string } | { kind: 'loop'; id: string }

/**
 * Loop nesting depth ceiling (root = depth 0; a top-level loop is depth 1). Hardcoded rather
 * than configurable — this is a readability ceiling on indentation-based nesting, not a value
 * expected to change per-deployment, and there's no config surface for builder tunables today.
 */
export const MAX_LOOP_DEPTH = 3

/**
 * A real, executable row produced by unrolling a loop at queue time (see
 * pipelineUtils.unrollForExecution) — mirrors `pipeline_steps` once `group_id`/`iteration_path`
 * exist there. Structurally still a `Step` (same fields the executors already read), plus:
 * - `iterationPath`: `null` for an always-real top-level step; `[i]`, `[i,j]`, ... (length =
 *   nesting depth) for a clone of a loop-body step, one array segment per ancestor loop's
 *   iteration index, outermost first.
 * - `dependsOnStepId`: always `null` today — nothing in the builder sets this field yet (see
 *   pipeline-flow-context.md's sequential-dependency concept), so there's no live data for the
 *   same truncate-to-common-ancestor remap `unrollForExecution` already applies to step_output
 *   references to exercise. The mechanism is in place; there's just nothing to remap yet.
 */
export interface UnrolledStep extends Step {
  iterationPath: number[] | null
  dependsOnStepId: string | null
}

/** A loop definition row as persisted — mirrors one `pipeline_step_groups` insert. */
export interface UnrolledGroup {
  id: string
  parentGroupId: string | null
  label: string
  iterationCount: number
}

/** In-progress add/edit form state for a step, before it's committed into `steps`. */
export interface StepDraft {
  id?: string
  tech: TechKey
  action: string
  machine: string
  inputs: Record<string, string>
  files?: Record<string, File>
  printSettings?: PrintSettings
  materialProfileId?: string | null
}

/** `'add'` while creating a new step, `'edit'` while editing an existing one, `null` when the draft form is closed. */
export type DraftMode = 'add' | 'edit' | null
