export type PrinterStatusType = 'idle' | 'printing' | 'paused' | 'error' | 'offline'
export type PrinterType = 'FGF' | 'FDM'

export interface Printer {
  id: string
  name: string
  model: string
  ip: string
  port: number
  type: PrinterType
  material: string | null
  build_volume: string | null
  is_active: boolean
  created_at: string
}

export interface PrinterStatus {
  printer_id: string
  online: boolean
  status: PrinterStatusType
  print_state: string | null
  filename: string | null
  progress: number
  layer_current: number | null
  layer_total: number | null
  hotend_temp: number | null
  hotend_target: number | null
  bed_temp: number | null
  bed_target: number | null
  eta_seconds: number | null
  updated_at: string
}

// Combined view used throughout the UI
export interface PrinterWithStatus extends Printer {
  printer_status: PrinterStatus | null
}
