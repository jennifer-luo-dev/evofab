// route.ts (api/camera-capture)
// Triggers an on-demand synced color+depth capture on a `camera`-type
// machine via the standalone Orbbec bridge (app/lib/camera.ts ->
// camera_orbbec_service.py). Used by the pipeline builder's Run Pipeline
// action for `camera` steps — see stepExecutors.ts's runCameraStep. Mirrors
// /api/actuate's shape.
//
// The bridge has no "last capture" cache — every GET /capture(/depth_and_
// color) grabs a fresh frame — so the exact bytes from this one capture are
// embedded here (photo as a data URL, depth as base64) rather than returned
// as a re-fetchable URL. runCameraStep wraps this response's `image_url`
// into `outputs.image_keys: [image_url]` (an `image_array` output, per
// action_types.output_schema) and the depth fields alongside it, so a later
// classification_model step's classifyPhoto can forward real per-pixel
// depth to /classify instead of falling back to brightness-only masking —
// see main.py's _annotate_curvature, which depth-gates contours to reject
// this rig's reflective enclosure walls when depth is available.
// classifyPhoto's `fetch(imageUrl)` and StepMonitorCard's `<img src>` both
// work on the photo's data URL with no changes needed, and redisplaying the
// image later never re-triggers the camera.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/app/lib/supabase-server'
import { captureDepthAndColor } from '@/app/lib/camera'

/** Falls back to the Orbbec bridge's default dev port when a machine row has none set. */
const DEFAULT_CAMERA_BRIDGE_PORT = 8002

/** POST /api/camera-capture — Body: `{ machineId }`. */
export async function POST(req: NextRequest) {
  const { machineId } = await req.json()

  if (!machineId) {
    return NextResponse.json({ error: 'machineId is required' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: machine, error: machineError } = await supabase
    .from('machines')
    .select('ip, port')
    .eq('id', machineId)
    .single()

  if (machineError || !machine?.ip) {
    return NextResponse.json({ error: 'Camera not found' }, { status: 404 })
  }

  const port = machine.port ?? DEFAULT_CAMERA_BRIDGE_PORT

  try {
    const capture = await captureDepthAndColor(machine.ip, port)
    const image_url = `data:image/jpeg;base64,${capture.jpeg.toString('base64')}`
    return NextResponse.json(
      {
        image_url,
        timestamp: Date.now(),
        depth_b64: capture.depthB64,
        depth_width: capture.depthWidth,
        depth_height: capture.depthHeight,
        depth_scale: capture.depthScale,
      },
      { status: 200 }
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
