// HistoryResultsTable.tsx
// Simple Type/Timestamp/Result table for one pipeline run's detail view,
// with a CSV export of the same rows.

'use client'

import { downloadBlob } from '@/app/lib/utils'
import type { ResultRow } from './types'

interface HistoryResultsTableProps {
  results: ResultRow[]
  /** Base filename (without extension) for the exported CSV. */
  exportName: string
}

/** Exports a set of result rows as a downloaded CSV file. */
function exportResultsCSV(results: ResultRow[], exportName: string) {
  const rows = [['Type', 'Timestamp', 'Result'], ...results.map((r) => [r.type, r.ts, r.result])]
  const csv = rows
    .map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
    .join('\n')
  downloadBlob(csv, `${exportName}.csv`, 'text/csv')
}

/** Read-only results table for a pipeline run, with a CSV export button. */
export function HistoryResultsTable({ results, exportName }: HistoryResultsTableProps) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-bold uppercase tracking-wide text-muted">Results</h3>
        <button
          type="button"
          onClick={() => exportResultsCSV(results, exportName)}
          disabled={!results.length}
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
          {results.map((r, i) => (
            <tr key={i} className="border-b border-border last:border-b-0">
              <td className="py-2.25 px-1.5">{r.type}</td>
              <td className="py-2.25 px-1.5 font-mono text-muted">{r.ts}</td>
              <td className="py-2.25 px-1.5">
                {r.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={r.imageUrl}
                    alt={r.result}
                    className="h-32 w-52 object-cover rounded border border-border"
                  />
                ) : (
                  r.result
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
