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
import { resolveMachine, callBridge } from '@/app/lib/machineRouting'

/** Falls back to the FastAPI bridge's default dev port when a machine row has none set. */
const DEFAULT_ROBOT_BRIDGE_PORT = 8001

/** POST /api/robot-stop — Body: `{ machineId }`. */
export async function POST(req: NextRequest) {
  const { machineId } = await req.json()

  if (!machineId) {
    return NextResponse.json({ error: 'machineId is required' }, { status: 400 })
  }

  const supabase = await createClient()
  const machine = await resolveMachine(supabase, machineId, 'Robot arm not found', DEFAULT_ROBOT_BRIDGE_PORT)
  if (machine instanceof NextResponse) return machine

  const result = await callBridge(() => stopRobot(machine.ip, machine.port))
  if (result instanceof NextResponse) return result
  return NextResponse.json(result, { status: 200 })
}
