import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/app/lib/supabase-server'

export async function GET() {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('jobs')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ jobs: data })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const body = await req.json()

  const { data: job, error } = await supabase
    .from('jobs')
    .insert({
      printer_id:          body.printer_id,
      experiment_id:       body.experiment_id ?? null,
      material_profile_id: body.material_profile_id ?? null,
      filename:            body.filename,
      print_settings:      body.print_settings ?? {},
      experiment_params:   body.experiment_params ?? {},
      status:              'queued',
      pipeline_step:       null,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ job }, { status: 201 })
}
