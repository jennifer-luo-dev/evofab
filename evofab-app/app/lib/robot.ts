// robot.ts
// Client for the UR7e robot-arm FastAPI bridge (app/api/python/main.py).
// Mirrors arduino.ts's style: plain async functions, raw fetch, descriptive
// thrown errors. Unlike the Arduino bridge, POST /robot/move blocks
// server-side until the move settles (or the safety/timeout check fails), so
// callers don't need to poll or time out the move themselves.

function base(ip: string, port: number) {
  return `http://${ip}:${port}`
}

export interface MoveResult {
  ok: boolean
  message: string
}

/** Sends a Cartesian move target (metres, robot base frame) and resolves once the bridge confirms arrival. */
export async function moveRobot(
  ip: string,
  port: number,
  x: number,
  y: number,
  z: number
): Promise<MoveResult> {
  const res = await fetch(`${base(ip, port)}/robot/move`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ x, y, z }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Robot move failed (${res.status}): ${text}`)
  }
  return res.json()
}
