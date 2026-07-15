// route.ts (api/action-types)
// Lists implemented action types grouped by their machine type's key — backs
// the Pipelines builder's per-technology action/input configuration.
// Replaces the former mockData.ts ACTIONS constant.
//
// Convention: `action_types.input_schema` and `.output_schema` each hold a
// bare `StepInputConfig[]` / `StepOutputConfig[]` array directly (see
// action_types_rows.sql); missing/malformed schemas fall back to no
// configurable inputs/outputs rather than failing the request.

import { NextResponse } from 'next/server'
import { createClient } from '@/app/lib/supabase-server'
import type {
  ActionConfig,
  StepInputConfig,
  StepOutputConfig,
  TechKey,
} from '@/app/components/pipelines/types'

export async function GET() {
  const supabase = await createClient()

  const { data: types, error: typesError } = await supabase
    .from('machine_types')
    .select('id, type_key')

  if (typesError) return NextResponse.json({ error: typesError.message }, { status: 500 })

  const { data: actions, error: actionsError } = await supabase
    .from('action_types')
    .select(
      'machine_type_id, type_key, display_name, input_schema, output_schema, is_implemented, created_at'
    )
    .eq('is_implemented', true)
    .order('created_at')

  if (actionsError) return NextResponse.json({ error: actionsError.message }, { status: 500 })

  const techKeyById = new Map((types ?? []).map((t) => [t.id, t.type_key as TechKey]))

  const actionsByTech: Partial<Record<TechKey, ActionConfig[]>> = {}
  for (const action of actions ?? []) {
    const tech = techKeyById.get(action.machine_type_id)
    if (!tech) continue
    const inputs: StepInputConfig[] = Array.isArray(action.input_schema) ? action.input_schema : []
    const outputs: StepOutputConfig[] = Array.isArray(action.output_schema)
      ? action.output_schema
      : []
    const config: ActionConfig = { key: action.type_key, label: action.display_name, inputs, outputs }
    ;(actionsByTech[tech] ??= []).push(config)
  }

  return NextResponse.json({ actionsByTech })
}
