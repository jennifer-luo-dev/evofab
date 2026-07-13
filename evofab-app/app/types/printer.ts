export type PrinterStatusType =
  "idle" | "printing" | "paused" | "error" | "offline";
export type PrinterType = "FGF" | "FDM";
export type PrinterTelemetrySource = "exact" | "estimated" | "unknown";
export type PrinterDriverType = "moonraker" | "prusalink";

export interface Printer {
  id: string;
  name: string;
  model: string;
  ip: string;
  port: number;
  driver_type?: PrinterDriverType;
  moonraker_host?: string | null;
  moonraker_port?: number | null;
  prusalink_host?: string | null;
  prusalink_key_file?: string | null;
  type: PrinterType;
  material: string | null;
  build_volume: string | null;
  webcam_url: string | null;
  is_active: boolean;
  created_at: string;
}

export interface PrinterStatus {
  printer_id: string;
  online: boolean;
  status: PrinterStatusType;
  print_state: string | null;
  filename: string | null;
  progress: number;
  layer_current: number | null;
  layer_total: number | null;
  hotend_temp: number | null;
  hotend_target: number | null;
  bed_temp: number | null;
  bed_target: number | null;
  eta_seconds: number | null;
  progress_source?: PrinterTelemetrySource;
  layer_source?: PrinterTelemetrySource;
  fault_message?: string | null;
  fault_mcu?: string | null;
  updated_at: string;
}
export interface PrinterLoadedMaterial {
  material_name: string;
  color: string;
  quantity: number;
  unit: "g" | "l";
}

// Combined view used throughout the UI
export interface PrinterWithStatus extends Omit<
  Printer,
  | "ip"
  | "port"
  | "moonraker_host"
  | "moonraker_port"
  | "prusalink_host"
  | "prusalink_key_file"
> {
  printer_status: PrinterStatus | null;
  loaded_material: PrinterLoadedMaterial | null;
}
