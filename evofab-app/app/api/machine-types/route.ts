// route.ts (api/machine-types)
// Lists machine types with their active machines — backs the Pipelines
// page's technology grid and per-technology machine pickers. Replaces the
// former mockData.ts TECHS/TECH_LABEL/MACHINES constants.

import { NextResponse } from 'next/server'
import { createClient } from '@/app/lib/supabase-server'

/** GET /api/machine-types — Returns every machine type with its active machines, ordered by display name. */
export async function GET() {
  const supabase = await createClient()

  const { data: types, error: typesError } = await supabase
    .from('machine_types')
    .select('id, type_key, display_name')
    .order('display_name')

  if (typesError) return NextResponse.json({ error: typesError.message }, { status: 500 })

  const { data: machines, error: machinesError } = await supabase
    .from('machines')
    .select('id, name, machine_type_id')
    .eq('is_active', true)
    .order('name')

  if (machinesError) return NextResponse.json({ error: machinesError.message }, { status: 500 })

  const machineTypes = (types ?? []).map((type) => ({
    id: type.id,
    key: type.type_key,
    name: type.display_name,
    machines: (machines ?? [])
      .filter((m) => m.machine_type_id === type.id)
      .map((m) => ({ id: m.id, name: m.name })),
  }))

  return NextResponse.json({ machineTypes })
}
