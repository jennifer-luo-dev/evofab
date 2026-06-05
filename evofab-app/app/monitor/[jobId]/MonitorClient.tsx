'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/app/lib/supabase'
import { useJob } from '@/app/contexts/JobContext'
import { PipelineTracker } from '@/app/components/monitor/PipelineTracker'
import { PrinterMetricsCard } from '@/app/components/monitor/PrinterMetricsCard'
import { RobotArmCard } from '@/app/components/monitor/RobotArmCard'
import { ExperimentCard } from '@/app/components/monitor/ExperimentCard'
import { CameraFeedCard } from '@/app/components/monitor/CameraFeedCard'
import { MLCharacterizationCard } from '@/app/components/monitor/MLCharacterizationCard'
import { SystemLogCard } from '@/app/components/monitor/SystemLogCard'
import type { Job, LogEntry, PipelineStepId } from '@/app/types/job'
import type { PrinterStatus } from '@/app/types/printer'

const INACTIVE_STATUSES = new Set(['complete', 'failed', 'aborted'])
const PRE_ML_STEPS = new Set<PipelineStepId>(['upload', 'printing', 'transfer', 'experiment', 'photobooth'])

interface Props {
  initialJob: Job
  initialLogs: LogEntry[]
  initialPrinterStatus: PrinterStatus | null
}

export function MonitorClient({ initialJob, initialLogs, initialPrinterStatus }: Props) {
  const router = useRouter()
  const { dispatch } = useJob()
  const [job, setJob] = useState<Job>(initialJob)
  const [printerStatus, setPrinterStatus] = useState<PrinterStatus | null>(initialPrinterStatus)

  useEffect(() => {
    if (!INACTIVE_STATUSES.has(job.status)) {
      dispatch({ type: 'START_JOB', jobId: job.id })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Subscribe to job updates
  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel(`job:${job.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'jobs', filter: `id=eq.${job.id}` },
        (payload) => {
          const updated = payload.new as Job
          setJob(updated)
          dispatch({ type: 'SET_STEP', step: updated.pipeline_step as PipelineStepId | null })
          if (updated.status === 'complete') {
            dispatch({ type: 'COMPLETE_JOB' })
            router.push(`/results/${job.id}`)
          }
          if (updated.status === 'aborted' || updated.status === 'failed') {
            dispatch({ type: 'ABORT_JOB' })
          }
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [job.id, dispatch, router])

  // Subscribe to printer_status for live temperatures
  useEffect(() => {
    if (!job.printer_id) return
    const supabase = createClient()
    const channel = supabase
      .channel(`printer_status:${job.printer_id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'printer_status',
          filter: `printer_id=eq.${job.printer_id}`,
        },
        (payload) => { setPrinterStatus(payload.new as PrinterStatus) }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [job.printer_id])

  const jobActive = !INACTIVE_STATUSES.has(job.status)
  const isPhotoStep = job.pipeline_step === 'photobooth'
  const mlStatus =
    !job.pipeline_step || PRE_ML_STEPS.has(job.pipeline_step)
      ? 'pending'
      : job.pipeline_step === 'ml'
      ? 'running'
      : job.status === 'complete'
      ? 'done'
      : 'pending'

  return (
    <div className="max-w-5xl mx-auto px-6 py-8 flex flex-col gap-4 animate-fade-up">
      <PipelineTracker currentStep={job.pipeline_step} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <PrinterMetricsCard
          printerName={initialJob.printer_id ?? '—'}
          jobProgress={job.print_progress}
          layerCurrent={job.layer_current}
          layerTotal={job.layer_total}
          printerStatus={printerStatus}
        />
        <RobotArmCard />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ExperimentCard
          cycles={job.experiment_params?.cycles}
          pressure={job.experiment_params?.pressure_kpa}
        />
        <CameraFeedCard live={isPhotoStep} showCrosshair={isPhotoStep} />
      </div>

      <MLCharacterizationCard status={mlStatus} />

      <SystemLogCard jobId={job.id} initialLogs={initialLogs} jobActive={jobActive} />
    </div>
  )
}
