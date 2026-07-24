// camera.ts
// Client for the standalone Orbbec bridge's GET /capture (see
// app/api/python/camera_orbbec_service.py — talks to the camera directly
// over USB via pyorbbecsdk, on its own fixed port, separate from the
// Arduino/UR7e bridge). Mirrors arduino.ts/classification.ts's style:
// plain async functions, raw fetch, descriptive thrown errors.
//
// Unlike the old main.py-based /camera/capture, this endpoint has no
// "last capture" cache — every request grabs a fresh frame — so this
// returns the raw JPEG bytes rather than a URL, letting the caller decide
// how to store/serve the exact bytes from this one capture (see
// app/api/camera-capture/route.ts, which embeds them as a data URL).

function base(ip: string, port: number) {
  return `http://${ip}:${port}`
}

/** Triggers an on-demand photo capture and returns the raw JPEG bytes. */
export async function capturePhoto(ip: string, port: number): Promise<Buffer> {
  const res = await fetch(`${base(ip, port)}/capture`)
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Camera capture failed (${res.status}): ${text}`)
  }
  return Buffer.from(await res.arrayBuffer())
}
