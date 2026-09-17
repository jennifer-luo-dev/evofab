// types.ts (machine-settings)
// UI types for the Machine Settings page, populated from `machine_types`/
// `machines`/`machine_type_fields` (see evofab-app/supabase/schema.sql) via
// /api/machine-settings.

import type { TechKey } from '@/app/types/machine'

/** One machine type section: its display columns and the machine rows currently configured. */
export interface MachineTypeConfig {
  key: TechKey
  name: string
  columns: string[]
  /** Each row's cell values, positionally matching `columns`. */
  rows: string[][]
}
