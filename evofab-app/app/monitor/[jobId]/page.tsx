import { createClient } from '@/app/lib/supabase-server'
import { getWebcamStreamUrl, getMoonrakerWsUrl } from '@/app/lib/moonraker'
import { MonitorClient } from './MonitorClient'
import { MonitorEmptyState } from '@/app/components/monitor/MonitorEmptyState'
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

  if (!job) return <MonitorEmptyState jobId={jobId} />

  const [{ data: logs }, { data: printerStatus }, { data: printer }] = await Promise.all([
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
    job.printer_id
      ? supabase
          .from('printers')
          .select('ip, port')
          .eq('id', job.printer_id)
          .single()
      : Promise.resolve({ data: null }),
  ])

  const streamUrl = printer ? await getWebcamStreamUrl(printer.ip, printer.port) : null
  const moonrakerWsUrl = printer ? getMoonrakerWsUrl(printer.ip, printer.port) : null

  return (
    <MonitorClient
      initialJob={job as Job}
      initialLogs={(logs as LogEntry[]) ?? []}
      initialPrinterStatus={(printerStatus as PrinterStatus | null) ?? null}
      streamUrl={streamUrl}
      moonrakerWsUrl={moonrakerWsUrl}
    />
  )
}
