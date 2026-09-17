// route.ts (api/print/pause)
// Pauses the active print on a `printer`-type machine via Moonraker's
// /printer/print/pause (see app/lib/moonraker.ts's pausePrint). Used by the
// pipeline builder's per-step Stop button while a printer step is in flight —
// the client-side waitForPrintCompletion poll then sees the print leave the
// `printing` state. Mirrors /api/print's machine lookup.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/app/lib/supabase-server'
import { pausePrint } from '@/app/lib/moonraker'
import { resolveMachine, callBridge } from '@/app/lib/machineRouting'

/** Falls back to Moonraker's default port when a machine row has none set. */
const DEFAULT_MOONRAKER_PORT = 7125

/** POST /api/print/pause — Body: `{ machineId }`. */
export async function POST(req: NextRequest) {
  const { machineId } = await req.json()

  if (!machineId) {
    return NextResponse.json({ error: 'machineId is required' }, { status: 400 })
  }

  const supabase = await createClient()
  const machine = await resolveMachine(supabase, machineId, 'Printer not found', DEFAULT_MOONRAKER_PORT)
  if (machine instanceof NextResponse) return machine

  const result = await callBridge(() => pausePrint(machine.ip, machine.port))
  if (result instanceof NextResponse) return result
  return NextResponse.json({ success: true }, { status: 200 })
}
