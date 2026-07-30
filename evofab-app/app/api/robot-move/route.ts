// route.ts (api/robot-move)
// Sends a Cartesian or joint-space move command to a `robot_arm`-type machine
// via the FastAPI bridge (app/lib/robot.ts). Used by the pipeline builder's
// Run Pipeline action for `robot_arm` Move steps — see stepExecutors.ts.
// Mirrors /api/actuate's shape. Blocks until the bridge confirms the move's
// outcome, since /robot/move itself only responds once the physical move
// settles — see app/api/python/main.py's _execute_cartesian_move /
// _execute_joint_move. A non-2xx response here means the request itself was
// malformed or the machine/bridge was unreachable; a runtime outcome that
// isn't a clean success (protective_stop, limit_violation, failed) still
// comes back as a 200 with `status` set accordingly — see MoveResult.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/app/lib/supabase-server'
import { moveRobot, type MoveTargetBody } from '@/app/lib/robot'

/** Falls back to the FastAPI bridge's default dev port when a machine row has none set. */
const DEFAULT_ROBOT_BRIDGE_PORT = 8001

/** POST /api/robot-move — Body: `{ machineId, ...MoveTargetBody }` (a Cartesian or joint-space target — see app/lib/robot.ts). */
export async function POST(req: NextRequest) {
  const { machineId, ...body } = await req.json()

  if (!machineId || (body.target_type !== 'cartesian' && body.target_type !== 'joint')) {
    return NextResponse.json({ error: 'machineId and a valid target_type are required' }, { status: 400 })
  }
  if (body.target_type === 'cartesian' && !body.position) {
    return NextResponse.json({ error: 'position is required for a cartesian move' }, { status: 400 })
  }
  if (body.target_type === 'joint' && (!body.mode || !Array.isArray(body.joints) || body.joints.length === 0)) {
    return NextResponse.json({ error: 'mode and at least one joint are required for a joint move' }, { status: 400 })
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
    const result = await moveRobot(machine.ip, port, body as MoveTargetBody)
    return NextResponse.json(result, { status: 200 })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
