// JobMetadataHeader.tsx
// Results page header summarizing job metadata, with JSON download and
// CSV export actions for the single result record.

'use client'

import { downloadBlob } from '@/app/lib/utils'
import type { ResultWithContext } from '@/app/types/result'

interface JobMetadataHeaderProps {
  result: ResultWithContext
}

/** Job summary header with JSON download and CSV export actions. */
export function JobMetadataHeader({ result }: JobMetadataHeaderProps) {
  const job = result.job
  const printer = job?.printer?.name ?? '—'
  const material = job?.material_profile?.name ?? '—'
  const nozzle = job?.print_settings?.nozzle_temp ?? '—'
  const cycles = job?.experiment_params?.cycles ?? '—'
  const pressure = job?.experiment_params?.pressure_kpa ?? '—'

  /** Downloads the full result record as a pretty-printed JSON file. */
  function downloadJSON() {
    downloadBlob(JSON.stringify(result, null, 2), `evofab-result-${result.id.slice(0, 8)}.json`, 'application/json')
  }

  /** Flattens the result record's key fields and downloads them as a single-row CSV. */
  function exportCSV() {
    const flat = {
      id: result.id,
      job_id: result.job_id,
      printer,
      material,
      nozzle_temp: nozzle,
      cycles,
      pressure_kpa: pressure,
      curvature_before: result.curvature_before,
      curvature_after: result.curvature_after,
      delta: result.delta,
      delta_pct: result.delta_pct,
      confidence: result.confidence,
      passed: result.passed,
      created_at: result.created_at,
    }
    const keys = Object.keys(flat) as (keyof typeof flat)[]
    const csv = [keys.join(','), keys.map((k) => flat[k] ?? '').join(',')].join('\n')
    downloadBlob(csv, `evofab-result-${result.id.slice(0, 8)}.csv`, 'text/csv')
  }

  return (
    <div className="flex items-start justify-between gap-4 p-5 rounded-xl border border-border bg-surface">
      <div>
        <p className="text-xs text-muted uppercase tracking-widest mb-1">Job Result</p>
        <p className="font-mono text-sm text-text">{printer} · {material}</p>
        <div className="flex flex-wrap gap-4 mt-2">
          {[
            { label: 'Timestamp', value: new Date(result.created_at).toLocaleString() },
            { label: 'Nozzle',    value: `${nozzle}°C` },
            { label: 'Cycles',    value: String(cycles) },
            { label: 'Pressure',  value: `${pressure} kPa` },
          ].map((item) => (
            <div key={item.label} className="flex flex-col">
              <span className="text-[10px] uppercase tracking-wider text-muted">{item.label}</span>
              <span className="font-mono text-xs text-text">{item.value}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="flex gap-2 shrink-0">
        <button
          onClick={downloadJSON}
          className="px-3 py-1.5 rounded-lg text-xs font-medium border border-border text-muted hover:text-text hover:border-border-2 transition-all"
        >
          Download JSON
        </button>
        <button
          onClick={exportCSV}
          className="px-3 py-1.5 rounded-lg text-xs font-medium border border-border text-muted hover:text-text hover:border-border-2 transition-all"
        >
          Export CSV
        </button>
      </div>
    </div>
  )
}
