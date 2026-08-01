// page.tsx (history)
// History page: browse past/current pipeline runs (including ones started
// from the Pipelines builder, which links here as soon as Run Pipeline
// persists the run) and drill into one run's results and live progress.
// The selected run is mirrored into the `?pipeline=` query param so a
// reload — e.g. while a print from the builder is still going — lands back
// on the same run instead of losing it.

'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { PipelineHistoryDetail } from '@/app/components/history/PipelineHistoryDetail'
import { PipelineHistoryList } from '@/app/components/history/PipelineHistoryList'
import type { PipelineSummary } from '@/app/components/history/types'

const ACTIVE_STATUSES = new Set(['queued', 'running'])
const LIST_POLL_INTERVAL_MS = 4000

/** List of pipeline runs, or one run's detail view when selected. */
export default function HistoryPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [pipelines, setPipelines] = useState<PipelineSummary[]>([])
  const selectedId = searchParams.get('pipeline')

  useEffect(() => {
    let cancelled = false

    async function load() {
      const res = await fetch('/api/pipelines')
      const data = await res.json()
      if (!cancelled) setPipelines(data.pipelines ?? [])
    }

    load()
    const hasActive = pipelines.some((p) => ACTIVE_STATUSES.has(p.status))
    const id = hasActive ? setInterval(load, LIST_POLL_INTERVAL_MS) : undefined
    return () => {
      cancelled = true
      if (id) clearInterval(id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pipelines.some((p) => ACTIVE_STATUSES.has(p.status))])

  function selectPipeline(id: string | null) {
    router.push(id ? `/history?pipeline=${id}` : '/history')
  }

  async function deletePipeline(id: string) {
    setPipelines((prev) => prev.filter((p) => p.id !== id))
    if (selectedId === id) selectPipeline(null)
    const res = await fetch(`/api/pipelines/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      console.error('Failed to delete pipeline run', await res.text().catch(() => ''))
      // Re-fetch so a failed delete doesn't leave the list silently wrong.
      const refetch = await fetch('/api/pipelines')
      const data = await refetch.json()
      setPipelines(data.pipelines ?? [])
    }
  }

  const selected = pipelines.find((p) => p.id === selectedId) ?? null

  if (selectedId && selected) {
    return (
      <PipelineHistoryDetail pipeline={selected} onBack={() => selectPipeline(null)} onDelete={deletePipeline} />
    )
  }

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-xl font-semibold text-text mb-1">Activity History</h1>
        <p className="text-[13.5px] text-muted">
          Current and past pipeline runs. Click one to see its progress and results.
        </p>
      </div>
      <PipelineHistoryList pipelines={pipelines} onSelect={selectPipeline} onDelete={deletePipeline} />
    </div>
  )
}
