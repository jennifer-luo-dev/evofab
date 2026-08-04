// page.tsx (history)
// History page: browse past/current pipeline runs (including ones started
// from the Pipelines builder, which links here as soon as Run Pipeline
// persists the run) and drill into one run's results and live progress —
// plus a separate "Saved" tab for pipelines stored via the builder's "Save
// Pipeline" (status `draft`, never dispatched — see PipelineBuilder.
// savePipeline) rather than run. Both tabs share the same `/api/pipelines`
// list, split client-side by `status`, and the same delete flow; a saved
// pipeline has no progress/results worth a detail view, so selecting one
// opens it straight in the builder to edit (`/pipelines?edit=<id>`) instead.
// The active tab and, on the runs tab, the selected run are both mirrored
// into the query string (`?tab=`, `?pipeline=`) so a reload — e.g. while a
// print from the builder is still going — lands back in the same place.

'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { cn } from '@/app/lib/utils'
import { PipelineHistoryDetail } from '@/app/components/history/PipelineHistoryDetail'
import { PipelineHistoryList } from '@/app/components/history/PipelineHistoryList'
import type { PipelineSummary } from '@/app/components/history/types'

const ACTIVE_STATUSES = new Set(['queued', 'running'])
const LIST_POLL_INTERVAL_MS = 4000

type Tab = 'runs' | 'saved'

/** List of pipeline runs (or saved pipelines), or one run's detail view when selected. */
export default function HistoryPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [pipelines, setPipelines] = useState<PipelineSummary[]>([])
  const selectedId = searchParams.get('pipeline')
  const tab: Tab = searchParams.get('tab') === 'saved' ? 'saved' : 'runs'

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

  function switchTab(next: Tab) {
    router.push(next === 'saved' ? '/history?tab=saved' : '/history')
  }

  function selectPipeline(id: string | null) {
    router.push(id ? `/history?pipeline=${id}` : '/history')
  }

  /** A saved pipeline was never run, so it has nothing worth a detail view — open it straight in the builder instead. */
  function selectRow(id: string) {
    if (tab === 'saved') router.push(`/pipelines?edit=${id}`)
    else selectPipeline(id)
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

  const visiblePipelines = pipelines.filter((p) => (tab === 'saved' ? p.status === 'draft' : p.status !== 'draft'))

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-xl font-semibold text-text mb-1">Activity History</h1>
        <p className="text-[13.5px] text-muted">
          {tab === 'saved'
            ? 'Pipelines saved from the builder without running them. Click one to open it for editing.'
            : 'Current and past pipeline runs. Click one to see its progress and results.'}
        </p>
      </div>

      <div className="inline-flex rounded-md border border-border overflow-hidden text-xs mb-4">
        {(
          [
            ['runs', 'History'],
            ['saved', 'Saved Pipelines'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => switchTab(key)}
            className={cn('px-3.5 py-1.5 font-semibold', tab === key ? 'bg-teal text-bg' : 'bg-surface text-muted')}
          >
            {label}
          </button>
        ))}
      </div>

      <PipelineHistoryList pipelines={visiblePipelines} onSelect={selectRow} onDelete={deletePipeline} variant={tab} />
    </div>
  )
}
