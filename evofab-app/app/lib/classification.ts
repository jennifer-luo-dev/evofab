// classification.ts
// Client for the classification-model FastAPI bridge's POST /classify (see
// app/api/python/main.py). Mirrors robot.ts/arduino.ts's style: plain async
// functions, raw fetch, descriptive thrown errors.

function base(ip: string, port: number) {
  return `http://${ip}:${port}`
}

/**
 * Mirrors POST /classify's response, which matches action_types.output_schema for
 * classification_model's "classify" action exactly (see stepExecutors.ts's classifyPhoto).
 */
export interface ClassifyResult {
  analysis_status: string
  mean_curvature: number | null
  bend_angle_deg: number | null
  radius_mm: number | null
  ppm_used: number
  actuator_length_mm: number
  /** Path of the annotated (mask/skeleton/fit overlay) photo, relative to the bridge — resolved to an absolute URL below. */
  image_url: string | null
}

/**
 * Raw depth capture to accompany a photo, matching camera_orbbec_service.py's
 * GET /capture/depth_and_color convention: `data` is the raw uint16 depth
 * array bytes (row-major, height x width), `scale` is mm-per-raw-unit (not
 * already millimetres).
 */
export interface DepthPayload {
  data: Blob
  width: number
  height: number
  scale: number
}

/**
 * Sends a photo to the classification bridge and runs the curvature-vision pipeline
 * (analyzer.py mask -> skeleton, geometry.py circle fit) on it, tuned with the machine's
 * z_min_m/z_max_m/threshold (machine_classification_model columns). Any omitted opt falls back
 * to analyzer.py's own defaults.
 *
 * `depth`, if given, switches masking to real per-pixel depth-gating
 * (z_min/z_max) server-side instead of brightness thresholding — see
 * main.py's POST /classify and _annotate_curvature. Omit it to fall back to
 * brightness thresholding, same as before depth support existed.
 */
export async function classifyImage(
  ip: string,
  port: number,
  image: Blob,
  opts: { z_min?: number | null; z_max?: number | null; threshold?: number | null; depth?: DepthPayload | null }
): Promise<ClassifyResult> {
  const form = new FormData()
  form.append('file', image, 'frame.jpg')
  if (opts.z_min != null) form.append('z_min', String(opts.z_min))
  if (opts.z_max != null) form.append('z_max', String(opts.z_max))
  if (opts.threshold != null) form.append('threshold', String(opts.threshold))
  if (opts.depth) {
    form.append('depth_file', opts.depth.data, 'depth.bin')
    form.append('depth_width', String(opts.depth.width))
    form.append('depth_height', String(opts.depth.height))
    form.append('depth_scale', String(opts.depth.scale))
  }

  const res = await fetch(`${base(ip, port)}/classify`, { method: 'POST', body: form })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Classification failed (${res.status}): ${text}`)
  }

  const result: ClassifyResult = await res.json()
  return { ...result, image_url: result.image_url ? `${base(ip, port)}${result.image_url}` : null }
}
