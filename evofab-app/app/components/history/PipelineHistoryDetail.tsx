// PipelineHistoryDetail.tsx
// Detail view for a single pipeline run: its results table and a read-only
// step-by-step progress tracker alongside a machine status panel.

'use client'

import { Fragment, useEffect, useState } from 'react'
import { MACHINE_TYPE_ICONS } from '@/app/components/ui/icons'
import { PipelineStepRow } from '@/app/components/pipelines/PipelineStepRow'
import { StepConnector } from '@/app/components/pipelines/StepConnector'
import { SyncedStepGroup } from '@/app/components/pipelines/SyncedStepGroup'
import { HistoryResultsTable } from './HistoryResultsTable'
import { MachinePanel } from './MachinePanel'
import { PipelineStatusBadge } from './PipelineStatusBadge'
import { computeProgressUnits } from './historyUtils'
import type {
  MachineStatusRow,
  PipelineRunStatus,
  PipelineSummary,
  ProgressStep,
  ResultRow,
} from './types'

const ACTIVE_STATUSES = new Set<PipelineRunStatus>(['queued', 'running'])
const DETAIL_POLL_INTERVAL_MS = 3000

interface PipelineHistoryDetailProps {
  pipeline: PipelineSummary
  onBack: () => void
}

interface PipelineDetail {
  /** The run's live status, fresher than the `pipeline` prop (which is a point-in-time snapshot from the list). */
  status: PipelineRunStatus | null
  progress: ProgressStep[]
  results: ResultRow[]
  machineStatus: MachineStatusRow[]
}

const EMPTY_DETAIL: PipelineDetail = { status: null, progress: [], results: [], machineStatus: [] }

/** Fetches a pipeline run's step progress, results, and machine statuses from `/api/pipelines/[id]`, polling while the run is still active so a reload mid-run keeps updating live. */
function usePipelineDetail(pipelineId: string): PipelineDetail {
  const [detail, setDetail] = useState<PipelineDetail>(EMPTY_DETAIL)

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    async function load() {
      const res = await fetch(`/api/pipelines/${pipelineId}`)
      const data = await res.json()
      if (cancelled) return
      const status: PipelineRunStatus | null = data.pipeline?.status ?? null
      setDetail({
        status,
        progress: data.progress ?? [],
        results: data.results ?? [],
        machineStatus: data.machineStatus ?? [],
      })
      if (status && ACTIVE_STATUSES.has(status)) {
        timer = setTimeout(load, DETAIL_POLL_INTERVAL_MS)
      }
    }

    load()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [pipelineId])

  return detail
}

/** Renders one progress-tracker row for a run's step, with a trailing status badge instead of edit controls. */
function renderProgressRow(step: ProgressStep, numberLabel: string | number, synced: boolean) {
  const Icon = MACHINE_TYPE_ICONS[step.tech] ?? MACHINE_TYPE_ICONS.DEFAULT
  return (
    <PipelineStepRow
      key={`${step.num}-${step.tech}-${step.label}`}
      icon={<Icon className="w-4 h-4" />}
      number={numberLabel}
      title={
        <>
          <span>{step.label}</span> — {step.machine}
        </>
      }
      synced={synced}
      highlighted={step.status === 'running'}
      trailing={<PipelineStatusBadge status={step.status} />}
    />
  )
}

/** Back link, run header, results table, and progress tracker + machine panel for one pipeline run. */
export function PipelineHistoryDetail({ pipeline, onBack }: PipelineHistoryDetailProps) {
  const { status, progress, results, machineStatus } = usePipelineDetail(pipeline.id)
  const progressUnits = computeProgressUnits(progress)
  const exportSlug = pipeline.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')

  return (
    <div>
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-muted hover:text-text mb-3.5"
      >
        ← Back to History
      </button>

      <div className="flex items-center gap-2.5 mb-5.5">
        <h1 className="text-[19px] font-semibold text-text">{pipeline.name}</h1>
        <PipelineStatusBadge status={status ?? pipeline.status} />
      </div>

      <div className="mb-6.5">
        <HistoryResultsTable results={results} exportName={exportSlug} />
      </div>

      <h3 className="text-xs uppercase tracking-wide text-muted font-bold mb-2.5">
        Pipeline Progress
      </h3>
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_250px] gap-5.5 items-start">
        <div>
          {progressUnits.map((unit, uIdx) => (
            <Fragment key={`${unit[0].num}-${unit[0].tech}`}>
              {unit.length > 1 ? (
                <SyncedStepGroup>
                  {unit.map((step) => renderProgressRow(step, step.num, true))}
                </SyncedStepGroup>
              ) : (
                renderProgressRow(unit[0], unit[0].num, false)
              )}
              {uIdx < progressUnits.length - 1 && <StepConnector />}
            </Fragment>
          ))}
        </div>
        <MachinePanel machines={machineStatus} />
      </div>
    </div>
  )
}
