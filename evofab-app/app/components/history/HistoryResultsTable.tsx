// HistoryResultsTable.tsx
// Trial/Type/Timestamp/Result/Photo table for one pipeline run's detail view,
// with a CSV export of the same rows and a click-to-enlarge photo viewer.
// Only characterization results (classification_model steps) are shown —
// actuation and movement steps are omitted. The photo for each row is the
// frame the measurement was taken from, loaded lazily per row from
// /api/pipeline-steps/[id]/image.

'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { downloadBlob } from '@/app/lib/utils'
import type { ResultRow } from './types'

/** Step tech whose output is a characterization result. */
const CHARACTERIZATION_TECHS = new Set(['classification_model'])

/** "Measure Curvature" persists its result as `TRACKING — 12.3°`; when it's tracking,
 * show only the angle. `NO_TARGET` / `MATH_ERROR` results are shown unchanged. */
const TRACKING_PREFIX = 'TRACKING — '
function formatResult(result: string): string {
  return result.startsWith(TRACKING_PREFIX) ? result.slice(TRACKING_PREFIX.length) : result
}

/** URL of the captured frame for a result row, or null if it has no source photo. */
function photoUrl(row: ResultRow): string | null {
  return row.photoStepId ? `/api/pipeline-steps/${row.photoStepId}/image` : null
}

interface HistoryResultsTableProps {
  results: ResultRow[]
  /** Base filename (without extension) for the exported CSV. */
  exportName: string
}

/** Exports a set of result rows as a downloaded CSV file. */
function exportResultsCSV(results: ResultRow[], exportName: string) {
  const rows = [
    ['Trial', 'Type', 'Timestamp', 'Result'],
    ...results.map((r) => [r.trial ?? '', r.type, r.ts, formatResult(r.result)]),
  ]
  const csv = rows
    .map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
    .join('\n')
  downloadBlob(csv, `${exportName}.csv`, 'text/csv')
}

/** Full-size photo viewer with prev/next through the rows that have a photo. */
function PhotoViewer({
  rows,
  index,
  onClose,
  onStep,
}: {
  rows: ResultRow[]
  index: number
  onClose: () => void
  onStep: (delta: number) => void
}) {
  const row = rows[index]

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft') onStep(-1)
      else if (e.key === 'ArrowRight') onStep(1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, onStep])

  if (!row) return null
  const url = photoUrl(row)

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/80 p-6"
      onClick={onClose}
    >
      <div
        className="relative max-h-full max-w-5xl overflow-auto rounded-lg bg-surface p-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center justify-between gap-4 text-xs">
          <span className="font-mono text-muted">
            {row.trial ? `Trial ${row.trial}` : row.type} · {row.ts} ·{' '}
            <span className="text-text">{formatResult(row.result)}</span>
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => onStep(-1)}
              disabled={index === 0}
              className="rounded px-2 py-1 text-muted hover:text-text disabled:opacity-30"
            >
              ← Prev
            </button>
            <button
              type="button"
              onClick={() => onStep(1)}
              disabled={index === rows.length - 1}
              className="rounded px-2 py-1 text-muted hover:text-text disabled:opacity-30"
            >
              Next →
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded px-2 py-1 font-semibold text-muted hover:text-text"
            >
              ✕
            </button>
          </div>
        </div>
        {url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt={`Capture for ${row.trial ? `trial ${row.trial}` : row.type}`}
            className="max-h-[75vh] w-auto rounded border border-border"
          />
        )}
        <a
          href={url ?? '#'}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-block text-[11px] text-teal hover:underline"
        >
          Open full resolution ↗
        </a>
      </div>
    </div>
  )
}

/** Read-only results table for a pipeline run, with a CSV export button and a photo viewer. */
export function HistoryResultsTable({ results, exportName }: HistoryResultsTableProps) {
  const rows = useMemo(
    () => results.filter((r) => CHARACTERIZATION_TECHS.has(r.tech)),
    [results]
  )
  /** Rows that actually have a photo — what the viewer's prev/next steps through. */
  const photoRows = useMemo(() => rows.filter((r) => photoUrl(r)), [rows])
  const [viewerIndex, setViewerIndex] = useState<number | null>(null)

  const showTrial = rows.some((r) => r.trial)
  const showPhoto = photoRows.length > 0

  const openViewer = useCallback(
    (row: ResultRow) => setViewerIndex(photoRows.indexOf(row)),
    [photoRows]
  )
  const stepViewer = useCallback(
    (delta: number) =>
      setViewerIndex((i) =>
        i === null ? i : Math.min(photoRows.length - 1, Math.max(0, i + delta))
      ),
    [photoRows.length]
  )

  const columns = [
    ...(showTrial ? ['Trial'] : []),
    'Type',
    'Timestamp',
    'Result',
    ...(showPhoto ? ['Photo'] : []),
  ]

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-bold uppercase tracking-wide text-muted">Results</h3>
        <button
          type="button"
          onClick={() => exportResultsCSV(rows, exportName)}
          disabled={!rows.length}
          className="px-3 py-1.5 rounded-lg text-xs font-medium border border-border text-muted hover:text-text hover:border-border-2 transition-all disabled:opacity-30"
        >
          Export CSV
        </button>
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border">
            {columns.map((col) => (
              <th
                key={col}
                className="py-2 px-1.5 text-left text-[11px] uppercase tracking-wide text-muted font-semibold"
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const url = photoUrl(r)
            return (
              <tr key={i} className="border-b border-border last:border-b-0">
                {showTrial && <td className="py-2.25 px-1.5 font-mono text-muted">{r.trial ?? '—'}</td>}
                <td className="py-2.25 px-1.5">{r.type}</td>
                <td className="py-2.25 px-1.5 font-mono text-muted">{r.ts}</td>
                <td className="py-2.25 px-1.5">{formatResult(r.result)}</td>
                {showPhoto && (
                  <td className="py-1.5 px-1.5">
                    {url ? (
                      <button
                        type="button"
                        onClick={() => openViewer(r)}
                        className="block overflow-hidden rounded border border-border hover:border-teal"
                        title="Click to enlarge"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={url}
                          alt={`Capture for ${r.trial ? `trial ${r.trial}` : r.type}`}
                          loading="lazy"
                          width={112}
                          height={63}
                          onError={(e) => {
                            e.currentTarget.style.display = 'none'
                          }}
                          className="h-15.75 w-28 object-cover"
                        />
                      </button>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>

      {viewerIndex !== null && (
        <PhotoViewer
          rows={photoRows}
          index={viewerIndex}
          onClose={() => setViewerIndex(null)}
          onStep={stepViewer}
        />
      )}
    </div>
  )
}
