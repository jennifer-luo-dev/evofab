// route.ts (api/pipelines)
// Lists pipeline runs newest-first with their step counts — backs the
// History page's run list. Replaces the former mockData.ts PIPELINES
// constant.

import { NextResponse } from 'next/server'
import { createClient } from '@/app/lib/supabase-server'

/** GET /api/pipelines — Returns all pipeline runs, newest-first. */
export async function GET() {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('pipelines')
    .select('id, name, status, created_at, pipeline_steps(count)')
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const pipelines = (data ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    date: new Date(p.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    status: p.status,
    steps: (p.pipeline_steps as unknown as { count: number }[])?.[0]?.count ?? 0,
  }))

  return NextResponse.json({ pipelines })
}
