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
 * Sends a photo to the classification bridge and runs the curvature-vision pipeline
 * (analyzer.py mask -> skeleton, geometry.py circle fit) on it, tuned with the machine's
 * z_min_m/z_max_m/threshold (machine_classification_model columns). Any omitted opt falls back
 * to analyzer.py's own defaults.
 */
export async function classifyImage(
  ip: string,
  port: number,
  image: Blob,
  opts: { z_min?: number | null; z_max?: number | null; threshold?: number | null }
): Promise<ClassifyResult> {
  const form = new FormData()
  form.append('file', image, 'frame.jpg')
  if (opts.z_min != null) form.append('z_min', String(opts.z_min))
  if (opts.z_max != null) form.append('z_max', String(opts.z_max))
  if (opts.threshold != null) form.append('threshold', String(opts.threshold))

  const res = await fetch(`${base(ip, port)}/classify`, { method: 'POST', body: form })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Classification failed (${res.status}): ${text}`)
  }

  const result: ClassifyResult = await res.json()
  return { ...result, image_url: result.image_url ? `${base(ip, port)}${result.image_url}` : null }
}
