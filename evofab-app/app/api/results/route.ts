// route.ts (api/results)
// Returns all curvature analysis result records, newest-first.

import { NextResponse } from 'next/server'
import { createClient } from '@/app/lib/supabase-server'

/** GET /api/results — Returns all result records ordered newest-first. */
export async function GET() {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('results')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ results: data })
}
