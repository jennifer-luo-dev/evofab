// HistoryResultsTable.tsx
// Simple Type/Timestamp/Result table for one pipeline run's detail view,
// with a CSV export of the same rows. Only characterization results
// (classification_model steps) are shown — captured photos, actuation, and
// movement steps are omitted.

'use client'

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

interface HistoryResultsTableProps {
  results: ResultRow[]
  /** Base filename (without extension) for the exported CSV. */
  exportName: string
}

/** Exports a set of result rows as a downloaded CSV file. */
function exportResultsCSV(results: ResultRow[], exportName: string) {
  const rows = [
    ['Type', 'Timestamp', 'Result'],
    ...results.map((r) => [r.type, r.ts, formatResult(r.result)]),
  ]
  const csv = rows
    .map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
    .join('\n')
  downloadBlob(csv, `${exportName}.csv`, 'text/csv')
}

/** Read-only results table for a pipeline run, with a CSV export button. */
export function HistoryResultsTable({ results, exportName }: HistoryResultsTableProps) {
  const rows = results.filter((r) => CHARACTERIZATION_TECHS.has(r.tech))

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
            {['Type', 'Timestamp', 'Result'].map((col) => (
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
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-border last:border-b-0">
              <td className="py-2.25 px-1.5">{r.type}</td>
              <td className="py-2.25 px-1.5 font-mono text-muted">{r.ts}</td>
              <td className="py-2.25 px-1.5">{formatResult(r.result)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
