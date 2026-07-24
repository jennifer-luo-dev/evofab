// route.ts (api/actuate)
// Fires a solenoid pulse on an `arduino`-type machine via the FastAPI bridge
// (app/lib/arduino.ts). Used by the pipeline builder's Run Pipeline action for
// `arduino` steps — see PipelineBuilder.runPipeline(). Mirrors /api/print's
// shape. Does not block for duration_ms — the bridge acks immediately once the
// serial write succeeds, and the caller (PipelineBuilder) times out the pulse
// client-side, exactly like /actuation/pulse's own contract.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/app/lib/supabase-server'
import { firePulse } from '@/app/lib/arduino'

/** Falls back to the FastAPI bridge's default dev port when a machine row has none set. */
const DEFAULT_ARDUINO_BRIDGE_PORT = 8001

/** POST /api/actuate — Body: `{ machineId, channel, duration_ms }`. */
export async function POST(req: NextRequest) {
  const { machineId, channel, duration_ms } = await req.json()

  if (!machineId || channel == null || duration_ms == null) {
    return NextResponse.json(
      { error: 'machineId, channel, and duration_ms are required' },
      { status: 400 }
    )
  }
  if (!(channel >= 1 && channel <= 4)) {
    return NextResponse.json({ error: 'channel must be 1-4' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: machine, error: machineError } = await supabase
    .from('machines')
    .select('ip, port')
    .eq('id', machineId)
    .single()

  if (machineError || !machine?.ip) {
    return NextResponse.json({ error: 'Arduino board not found' }, { status: 404 })
  }

  const port = machine.port ?? DEFAULT_ARDUINO_BRIDGE_PORT

  try {
    const result = await firePulse(machine.ip, port, channel, duration_ms)
    return NextResponse.json(result, { status: 200 })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
