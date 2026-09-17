// machine.ts
// The shared "which machine type is this" key, used across the Pipelines
// builder and Machine Settings. Previously declared twice — as `TechKey` in
// components/pipelines/types.ts and, separately, as `MachineTypeKey` in
// components/ui/icons.tsx — two names for the same underlying
// `machine_types.type_key` column (see evofab-app/supabase/schema.sql).
// `components/pipelines/types.ts` re-exports `TechKey` from here so its many
// existing importers are unaffected.

/**
 * A machine type's `type_key` — free-form lowercase snake_case (`printer`,
 * `robot_arm`, `arduino_board`, `camera`, `classification_model`, ...), not
 * a closed set. Any code keyed by `TechKey` (icon lookups, the Pipelines
 * step executor registry, stoppable-tech config) must tolerate unrecognized
 * keys, since a new machine_types row needs no code change to exist.
 */
export type TechKey = string
