// route.ts (api/jobs/[id]/logs)
// Reads and appends log entries for a single job.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/app/lib/supabase-server'

/** GET /api/jobs/[id]/logs — Returns all log entries for a job, oldest-first. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('logs')
    .select('*')
    .eq('job_id', id)
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ logs: data })
}

/** POST /api/jobs/[id]/logs — Appends a log entry to a job. Body: `{ message, type? }`. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const body = await req.json()

  const { data, error } = await supabase
    .from('logs')
    .insert({ job_id: id, message: body.message, type: body.type ?? 'default' })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ log: data }, { status: 201 })
}
