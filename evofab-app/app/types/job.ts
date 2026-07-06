export interface PrintSettings {
  nozzle_temp: number
  bed_temp: number
  speed: number
  flow_rate: number
  fan_speed: number
}

export interface ExperimentParams {
  cycles?: number
  pressure_kpa?: number
  hold_duration_s?: number
  [key: string]: unknown
}

export type JobStatus =
  | 'queued'
  | 'printing'
  | 'transferring'
  | 'experimenting'
  | 'photographing'
  | 'analysing'
  | 'complete'
  | 'failed'
  | 'aborted'

export type PipelineStepId =
  | 'upload'
  | 'printing'
  | 'transfer'
  | 'experiment'
  | 'photobooth'
  | 'ml'
  | 'complete'

export interface Job {
  id: string
  printer_id: string | null
  experiment_id: string | null
  material_profile_id: string | null
  filename: string
  file_key: string | null
  print_settings: PrintSettings
  experiment_params: ExperimentParams
  status: JobStatus
  pipeline_step: PipelineStepId | null
  print_progress: number
  layer_current: number | null
  layer_total: number | null
  created_at: string
  started_at: string | null
  completed_at: string | null
}

export interface LogEntry {
  id: string
  job_id: string | null
  message: string
  type: 'default' | 'info' | 'success' | 'warn' | 'error'
  created_at: string
}

export interface MaterialProfile {
  id: string
  name: string
  polymer: string
  nozzle_diameter_mm: number
  layer_height_mm: number
  line_width_mm: number
  temps_json: {
    feeding?: number
    melting?: number
    nozzle?: number
    bed?: number
    [key: string]: number | undefined
  }
  rotation_volume_mm3: number
  pellet_flow_coefficient: number
  pressure_advance: number
  pressure_advance_smooth_time: number
  max_volumetric_speed_mm3_s: number
  min_layer_time_s: number
  cooling_json: {
    fan_min_pct?: number
    fan_max_pct?: number
    no_cooling_first_layers?: number
    [key: string]: number | undefined
  }
  overrides_json: {
    retraction_length_mm?: number
    extra_length_on_restart_mm?: number
    wipe_distance_mm?: number
    z_hop_mm?: number
    [key: string]: number | undefined
  }
  density_g_cm3: number
  notes: string | null
  created_at: string
}

export interface Experiment {
  id: string
  name: string
  display_name: string
  description: string | null
  script_path: string
  default_params: ExperimentParams
  param_schema: {
    type: string
    properties: Record<string, {
      type: string
      minimum?: number
      maximum?: number
      title: string
    }>
    required?: string[]
  }
  created_at: string
}

export const PIPE_STEPS: { id: PipelineStepId; label: string; sub: string }[] = [
  { id: 'upload',     label: 'Upload',      sub: 'G-code validated' },
  { id: 'printing',   label: 'Printing',    sub: 'Klipper · FGF' },
  { id: 'transfer',   label: 'Transfer',    sub: 'UR7e → test bed' },
  { id: 'experiment', label: 'Experiment',  sub: 'Pressure cycling' },
  { id: 'photobooth', label: 'Photo Booth', sub: 'Orbbec 335L' },
  { id: 'ml',         label: 'ML Analysis', sub: 'OpenCV arc fit' },
  { id: 'complete',   label: 'Complete',    sub: 'Result saved' },
]
