import { notFound } from 'next/navigation'
import { createClient } from '@/app/lib/supabase-server'
import { MonitorClient } from './MonitorClient'
import type { Job, LogEntry } from '@/app/types/job'
import type { PrinterStatus } from '@/app/types/printer'

interface Props {
  params: Promise<{ jobId: string }>
}

export default async function MonitorPage({ params }: Props) {
  const { jobId } = await params
  const supabase = await createClient()

  const { data: job } = await supabase
    .from('jobs')
    .select('*')
    .eq('id', jobId)
    .single()

  if (!job) notFound()

  const [{ data: logs }, { data: printerStatus }] = await Promise.all([
    supabase
      .from('logs')
      .select('*')
      .eq('job_id', jobId)
      .order('created_at'),
    job.printer_id
      ? supabase
          .from('printer_status')
          .select('*')
          .eq('printer_id', job.printer_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  return (
    <MonitorClient
      initialJob={job as Job}
      initialLogs={(logs as LogEntry[]) ?? []}
      initialPrinterStatus={(printerStatus as PrinterStatus | null) ?? null}
    />
  )
}
