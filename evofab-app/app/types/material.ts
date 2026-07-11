export type MaterialTechnology = "FDM" | "FGF" | "SLA";
export type MaterialForm = "filament" | "pellet" | "resin";
export type MaterialSourceStatus =
  "verified" | "excluded" | "literature" | "supplier";
export type MaterialStockStatus = "in_stock" | "low" | "depleted";

export interface Material {
  id: string;
  slug: string;
  name: string;
  technology: MaterialTechnology;
  form: MaterialForm;
  provider: string | null;
  base_chemistry: string | null;
  nominal_hardness: string | null;
  source_status: MaterialSourceStatus;
  sds_url: string | null;
  science: Record<string, unknown>;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}
export interface MaterialStock {
  id: string;
  material_id: string;
  lot_label: string | null;
  quantity: number;
  unit: "spool" | "kg" | "l" | "unit";
  location: string | null;
  received_at: string;
  received_by: string | null;
  status: MaterialStockStatus;
}
export interface MaterialEvent {
  id: string;
  material_id: string;
  stock_id: string | null;
  event_type: "received" | "consumed" | "adjusted" | "retired";
  delta: number | null;
  actor: string | null;
  note: string | null;
  created_at: string;
}
export interface MaterialProfileBinding {
  id: string;
  name: string;
  printer_type: string;
  material_id: string | null;
}
export interface MaterialsSnapshot {
  materials: Material[];
  stock: MaterialStock[];
  events: MaterialEvent[];
  profiles: MaterialProfileBinding[];
}
