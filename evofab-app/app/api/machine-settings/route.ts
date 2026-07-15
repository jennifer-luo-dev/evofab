// route.ts (api/machine-settings)
// Lists every machine type with its configured machines as display
// columns/rows — backs the Machine Settings page. Column definitions come
// from `machine_type_fields`; per-machine values for those fields are read
// from that type's detail table (`machine_types.table_name`, e.g.
// `machine_printer`). Types with no detail table (e.g. Load Cell) or no
// configured fields simply get a Name/IP-only table. Replaces the former
// mockData.ts MACHINE_TYPES constant.

import { NextResponse } from 'next/server'
import { createClient } from '@/app/lib/supabase-server'

interface DetailRow {
  machine_id: string
  [field: string]: unknown
}

export async function GET() {
  const supabase = await createClient()

  const [typesRes, fieldsRes, machinesRes] = await Promise.all([
    supabase
      .from('machine_types')
      .select('id, type_key, display_name, table_name')
      .order('display_name'),
    supabase
      .from('machine_type_fields')
      .select('id, machine_type_id, field_key, label, ordinal')
      .order('ordinal'),
    supabase.from('machines').select('id, name, ip, machine_type_id').order('name'),
  ])

  if (typesRes.error) return NextResponse.json({ error: typesRes.error.message }, { status: 500 })
  if (fieldsRes.error) return NextResponse.json({ error: fieldsRes.error.message }, { status: 500 })
  if (machinesRes.error)
    return NextResponse.json({ error: machinesRes.error.message }, { status: 500 })

  const types = typesRes.data ?? []
  const fields = fieldsRes.data ?? []
  const machines = machinesRes.data ?? []

  const machineTypes = await Promise.all(
    types.map(async (type) => {
      const typeFields = fields.filter((f) => f.machine_type_id === type.id)
      const typeMachines = machines.filter((m) => m.machine_type_id === type.id)

      const detailsByMachineId = new Map<string, DetailRow>()
      if (typeFields.length > 0 && typeMachines.length > 0) {
        const selectCols = ['machine_id', ...typeFields.map((f) => f.field_key)].join(',')
        const { data: details } = await supabase
          .from(type.table_name)
          .select(selectCols)
          .in(
            'machine_id',
            typeMachines.map((m) => m.id)
          )
        for (const row of (details ?? []) as unknown as DetailRow[]) {
          detailsByMachineId.set(row.machine_id, row)
        }
      }

      return {
        key: type.type_key,
        name: type.display_name,
        columns: ['Name', ...typeFields.map((f) => f.label), 'IP'],
        rows: typeMachines.map((m) => [
          m.name,
          ...typeFields.map((f) => String(detailsByMachineId.get(m.id)?.[f.field_key] ?? '')),
          m.ip ?? '',
        ]),
      }
    })
  )

  return NextResponse.json({ machineTypes })
}
