// page.tsx (history)
// History page: browse past/current pipeline runs and drill into one run's
// results and live progress.

'use client'

import { useEffect, useState } from 'react'
import { PipelineHistoryDetail } from '@/app/components/history/PipelineHistoryDetail'
import { PipelineHistoryList } from '@/app/components/history/PipelineHistoryList'
import type { PipelineSummary } from '@/app/components/history/types'

/** List of pipeline runs, or one run's detail view when selected. */
export default function HistoryPage() {
  const [pipelines, setPipelines] = useState<PipelineSummary[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/pipelines')
      .then((res) => res.json())
      .then((data) => setPipelines(data.pipelines ?? []))
  }, [])

  const selected = pipelines.find((p) => p.id === selectedId) ?? null

  if (selected) {
    return <PipelineHistoryDetail pipeline={selected} onBack={() => setSelectedId(null)} />
  }

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-xl font-semibold text-text mb-1">Activity History</h1>
        <p className="text-[13.5px] text-muted">
          Current and past pipeline runs. Click one to see its progress and results.
        </p>
      </div>
      <PipelineHistoryList pipelines={pipelines} onSelect={setSelectedId} />
    </div>
  )
}
