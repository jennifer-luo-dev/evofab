// route.ts (api/print)
// Starts a print on a `printer`-type machine: uploads the G-code to
// Moonraker, applies print settings, and starts the print. Used by the
// pipeline builder's Run Pipeline action for `printer` steps — see
// PipelineBuilder.runPipeline(). There is no `jobs` table in the current
// schema (see evofab-app/supabase/schema.sql), so unlike the legacy
// /setup flow's /api/jobs, this does not persist a run record.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/app/lib/supabase-server'
import { uploadGcode, applyPrintSettings, startPrint } from '@/app/lib/moonraker'
import type { PrintSettings } from '@/app/types/job'

/** Falls back to Moonraker's default port when a machine row has none set. */
const DEFAULT_MOONRAKER_PORT = 7125

/**
 * POST /api/print — Expects multipart form data: file, machine_id, settings
 * (JSON-encoded PrintSettings), and print_profile_id (optional).
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const form = await req.formData()

  const file = form.get('file') as File | null
  const machine_id = form.get('machine_id') as string | null
  const print_profile_id = (form.get('print_profile_id') as string) || null
  const settingsRaw = form.get('settings') as string | null

  if (!file || !machine_id || !settingsRaw) {
    return NextResponse.json(
      { error: 'file, machine_id, and settings are required' },
      { status: 400 }
    )
  }
  const settings: PrintSettings = JSON.parse(settingsRaw)

  const { data: machine, error: machineError } = await supabase
    .from('machines')
    .select('ip, port')
    .eq('id', machine_id)
    .single()

  if (machineError || !machine?.ip) {
    return NextResponse.json({ error: 'Printer not found' }, { status: 404 })
  }

  const port = machine.port ?? DEFAULT_MOONRAKER_PORT

  let fileKey: string
  try {
    fileKey = await uploadGcode(machine.ip, port, file)
    await applyPrintSettings(machine.ip, port, settings)
    await startPrint(machine.ip, port, fileKey)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 502 })
  }

  return NextResponse.json({ success: true, fileKey, print_profile_id }, { status: 201 })
}
