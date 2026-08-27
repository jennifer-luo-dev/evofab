// robot.ts
// Client for the UR7e robot-arm FastAPI bridge (app/api/python/main.py).
// A single POST /robot/move endpoint handles both Cartesian and joint-space
// moves, discriminated by `target_type` — both converge on the same
// MoveResult shape (final_joint_positions_deg + final_tcp_pose) since
// downstream pipeline steps only care where the arm ended up, not how it got
// there. Mirrors arduino.ts's style: plain async functions, raw fetch,
// descriptive thrown errors. POST /robot/move blocks server-side until the
// move settles (or a shape/limit check fails), so callers don't need to poll
// or time out the move themselves.

export const JOINT_NAMES = ['base', 'shoulder', 'elbow', 'wrist_1', 'wrist_2', 'wrist_3'] as const
export type JointName = (typeof JOINT_NAMES)[number]

export const JOINT_LABELS: Record<JointName, string> = {
  base: 'Base',
  shoulder: 'Shoulder',
  elbow: 'Elbow',
  wrist_1: 'Wrist 1',
  wrist_2: 'Wrist 2',
  wrist_3: 'Wrist 3',
}

export interface JointRotation {
  joint: JointName
  angle_deg: number
}

export type MoveTargetBody =
  | {
      target_type: 'cartesian'
      /** `rx`/`ry`/`rz` (rotation vector, radians) are optional — omitted means "don't pin
       * orientation," and the bridge preserves whatever orientation the arm is already in
       * (see app/api/python/main.py's _execute_cartesian_move). */
      position: { x: number; y: number; z: number; rx?: number; ry?: number; rz?: number }
      speed_pct?: number
      acceleration_pct?: number
    }
  | {
      target_type: 'joint'
      mode: 'absolute' | 'relative'
      joints: JointRotation[]
      speed_pct?: number
      acceleration_pct?: number
    }

export interface MoveResult {
  status: 'success' | 'failed' | 'protective_stop' | 'limit_violation'
  final_joint_positions_deg: Partial<Record<JointName, number>>
  final_tcp_pose: { x: number; y: number; z: number; rx: number; ry: number; rz: number } | null
  duration_ms: number
  error?: string
}

function base(ip: string, port: number) {
  return `http://${ip}:${port}`
}

/** Sends a Cartesian or joint-space move target and resolves once the bridge confirms the outcome (success, failure, protective stop, or a pre-dispatch limit violation — see MoveResult.status). A non-2xx response means the request itself was malformed, not that the move failed. */
export async function moveRobot(ip: string, port: number, body: MoveTargetBody): Promise<MoveResult> {
  const res = await fetch(`${base(ip, port)}/robot/move`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Robot move failed (${res.status}): ${text}`)
  }
  return res.json()
}
