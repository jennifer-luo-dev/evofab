// arduino.ts
// Client for the Arduino solenoid-actuation FastAPI bridge (app/api/python/main.py).
// Mirrors moonraker.ts's style: plain async functions, raw fetch, descriptive
// thrown errors. The bridge acks a pulse request as soon as the serial write
// succeeds — it does not block until the pulse physically finishes — so
// callers must time out the duration themselves (see PipelineBuilder.runPipeline).

function base(ip: string, port: number) {
  return `http://${ip}:${port}`
}

export interface PulseResult {
  ok: boolean
  message: string
  capture_pending: boolean
}

/**
 * Fires a timed solenoid pulse on one channel (1-4). Always sends capture:false —
 * camera capture/curvature analysis is out of scope for this pipeline step type.
 * Resolves as soon as the Arduino's serial write succeeds; the caller must wait
 * out duration_ms itself to know the physical pulse is done.
 */
export async function firePulse(
  ip: string,
  port: number,
  channel: number,
  duration_ms: number
): Promise<PulseResult> {
  const res = await fetch(`${base(ip, port)}/actuation/pulse`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channel, duration_ms, capture: false }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Arduino pulse failed (${res.status}): ${text}`)
  }
  return res.json()
}
