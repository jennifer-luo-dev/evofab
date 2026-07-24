// route.ts (api/classify)
// Runs the classification-model curvature-vision pipeline on a photo produced
// by an earlier camera step. Mirrors /api/robot-move's shape: resolves
// `machineId` -> `machines.ip/port` (plus its `machine_classification_model`
// tuning row), fetches the source photo server-side, and forwards it to the
// FastAPI bridge's POST /classify — see stepExecutors.ts's classifyPhoto.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/app/lib/supabase-server'
import { classifyImage } from '@/app/lib/classification'

/** Falls back to the FastAPI bridge's default dev port when a machine row has none set. */
const DEFAULT_BRIDGE_PORT = 8001

interface MachineClassificationModelDetail {
  machine_id: string
  threshold: number | null
  z_min_m: number | null
  z_max_m: number | null
}

/** POST /api/classify — Body: `{ machineId, imageUrl }`. `imageUrl` is `outputs.image_keys[0]` from the source camera step. */
export async function POST(req: NextRequest) {
  const { machineId, imageUrl } = await req.json()

  if (!machineId || !imageUrl) {
    return NextResponse.json({ error: 'machineId and imageUrl are required' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: machine, error: machineError } = await supabase
    .from('machines')
    .select('ip, port')
    .eq('id', machineId)
    .single()

  if (machineError || !machine?.ip) {
    return NextResponse.json({ error: 'Classification model machine not found' }, { status: 404 })
  }

  const { data: detail } = await supabase
    .from('machine_classification_model')
    .select('machine_id, threshold, z_min_m, z_max_m')
    .eq('machine_id', machineId)
    .single<MachineClassificationModelDetail>()

  let imageBlob: Blob
  try {
    const imageRes = await fetch(imageUrl)
    if (!imageRes.ok) throw new Error(`HTTP ${imageRes.status}`)
    imageBlob = await imageRes.blob()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: `Could not fetch source photo: ${message}` }, { status: 502 })
  }

  const port = machine.port ?? DEFAULT_BRIDGE_PORT

  try {
    const result = await classifyImage(machine.ip, port, imageBlob, {
      z_min: detail?.z_min_m,
      z_max: detail?.z_max_m,
      threshold: detail?.threshold,
    })
    return NextResponse.json(result, { status: 200 })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
