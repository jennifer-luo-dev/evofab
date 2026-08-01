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

/** A synced color+depth capture — mirrors camera_orbbec_service.py's GET
 * /capture/depth_and_color response shape. `depthB64` is the raw uint16
 * depth array (row-major, depthHeight x depthWidth), base64-encoded and
 * left undecoded here so callers can pass it straight through (e.g. into
 * outputs.depth_b64 for a later classify step) without a decode/re-encode
 * round trip. `depthScale` is mm-per-raw-unit, not already millimetres. */
export interface DepthAndColorCapture {
  jpeg: Buffer
  depthB64: string
  depthWidth: number
  depthHeight: number
  depthScale: number
}

/** Triggers an on-demand synced color+depth capture. Needed (over plain
 * capturePhoto) wherever the caller wants real per-pixel depth-gated
 * masking downstream — see main.py's _annotate_curvature: without depth,
 * classification falls back to picking the largest bright contour, which
 * this rig's reflective test-enclosure walls can fool. */
export async function captureDepthAndColor(ip: string, port: number): Promise<DepthAndColorCapture> {
  const res = await fetch(`${base(ip, port)}/capture/depth_and_color`)
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Camera depth+color capture failed (${res.status}): ${text}`)
  }
  const body = await res.json()
  return {
    jpeg: Buffer.from(body.color_jpeg_b64, 'base64'),
    depthB64: body.depth_b64,
    depthWidth: body.depth_width,
    depthHeight: body.depth_height,
    depthScale: body.depth_scale,
  }
}
