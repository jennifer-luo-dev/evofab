// route.ts (api/pipeline-steps/[id])
// Updates a single pipeline step's execution status as Run Pipeline
// progresses through it — see PipelineBuilder.runPipeline(). Automatically
// stamps `started_at`/`completed_at` on the relevant status transitions so
// callers only need to report the status itself.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/app/lib/supabase-server'

const TERMINAL_STATUSES = new Set(['complete', 'failed', 'skipped'])

/**
 * PATCH /api/pipeline-steps/[id] — Body: `{ status, progress?, outputs? }`. Sets
 * `started_at` the first time a step becomes `running`, and `completed_at` when it
 * reaches a terminal status (`complete`/`failed`/`skipped`).
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const body = await req.json()

  const status: string | undefined = body.status
  if (!status) return NextResponse.json({ error: 'status is required' }, { status: 400 })

  const update: Record<string, unknown> = { status }
  if (typeof body.progress === 'number') update.progress = body.progress
  if (body.outputs) update.outputs = body.outputs
  if (status === 'running') update.started_at = new Date().toISOString()
  if (TERMINAL_STATUSES.has(status)) update.completed_at = new Date().toISOString()

  const { data, error } = await supabase
    .from('pipeline_steps')
    .update(update)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ step: data })
}
