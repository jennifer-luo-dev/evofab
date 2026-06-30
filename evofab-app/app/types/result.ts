import type { PrintSettings, ExperimentParams } from './job'
import type { Printer } from './printer'

/** Shared Supabase select string joining a result to its job, printer, material profile, and experiment. */
export const RESULT_SELECT = `
  *,
  job:jobs(
    filename,
    print_settings,
    experiment_params,
    printer:printers(name, model),
    material_profile:material_profiles(name, nozzle_temp),
    experiment:experiments(display_name)
  )
`

export interface ResultRecord {
  id: string
  job_id: string
  curvature_before: number | null
  curvature_after: number | null
  delta: number | null
  delta_pct: number | null
  confidence: number | null
  passed: boolean | null
  before_image_key: string | null
  after_image_key: string | null
  ml_output: Record<string, unknown>
  created_at: string
}

// Enriched type returned by queries that join through jobs → printers/material_profiles/experiments
export interface ResultWithContext extends ResultRecord {
  job: {
    filename: string
    print_settings: PrintSettings
    experiment_params: ExperimentParams
    printer: Pick<Printer, 'name' | 'model'> | null
    material_profile: { name: string; nozzle_temp: number } | null
    experiment: { display_name: string } | null
  } | null
}
