// types.ts (machine-settings)
// UI types for the Machine Settings page, populated from `machine_types`/
// `machines`/`machine_type_fields` (see evofab-app/supabase/schema.sql) via
// /api/machine-settings.

import type { MachineTypeKey } from '@/app/components/ui/icons'

/** One machine type section: its display columns and the machine rows currently configured. */
export interface MachineTypeConfig {
  key: MachineTypeKey
  name: string
  columns: string[]
  /** Each row's cell values, positionally matching `columns`. */
  rows: string[][]
}
