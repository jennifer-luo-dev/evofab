// route.ts (api/robot-move)
// Sends a Cartesian move command to a `robot_arm`-type machine via the FastAPI
// bridge (app/lib/robot.ts). Used by the pipeline builder's Run Pipeline
// action for `robot_arm` Move steps — see stepExecutors.ts. Mirrors
// /api/actuate's shape. Blocks until the bridge confirms the move settled (or
// rejects it), since /robot/move itself only responds once the physical move
// is done — see app/api/python/main.py's _execute_move.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/app/lib/supabase-server'
import { moveRobot } from '@/app/lib/robot'

/** Falls back to the FastAPI bridge's default dev port when a machine row has none set. */
const DEFAULT_ROBOT_BRIDGE_PORT = 8001

/** POST /api/robot-move — Body: `{ machineId, x, y, z }` (metres, robot base frame). */
export async function POST(req: NextRequest) {
  const { machineId, x, y, z } = await req.json()

  if (!machineId || x == null || y == null || z == null) {
    return NextResponse.json({ error: 'machineId, x, y, and z are required' }, { status: 400 })
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

  const port = machine.port ?? DEFAULT_ROBOT_BRIDGE_PORT

  try {
    const result = await moveRobot(machine.ip, port, x, y, z)
    return NextResponse.json(result, { status: 200 })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
