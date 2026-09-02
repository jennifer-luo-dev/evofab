// route.ts (api/robot-stop)
// Emergency-stops a `robot_arm`-type machine via the FastAPI bridge's POST
// /robot/stop (see app/api/python/main.py's _execute_robot_stop). Used by the
// pipeline builder's per-step Stop button while a robot Move step is in
// flight — the blocking /api/robot-move call it interrupts then returns a
// non-'success' MoveResult, failing that step. Mirrors /api/robot-move's
// machine lookup.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/app/lib/supabase-server'
import { stopRobot } from '@/app/lib/robot'

/** Falls back to the FastAPI bridge's default dev port when a machine row has none set. */
const DEFAULT_ROBOT_BRIDGE_PORT = 8001

/** POST /api/robot-stop — Body: `{ machineId }`. */
export async function POST(req: NextRequest) {
  const { machineId } = await req.json()

  if (!machineId) {
    return NextResponse.json({ error: 'machineId is required' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: machine, error: machineError } = await supabase
    .from('machines')
    .select('ip, port')
    .eq('id', machineId)
    .single()

  if (machineError || !machine?.ip) {
    return NextResponse.json({ error: 'Robot arm not found' }, { status: 404 })
  }

  try {
    const result = await stopRobot(machine.ip, machine.port ?? DEFAULT_ROBOT_BRIDGE_PORT)
    return NextResponse.json(result, { status: 200 })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
