import { ProgressBar } from '@/app/components/ui/ProgressBar'
import { MetricBox } from '@/app/components/ui/MetricBox'
import type { PrinterStatus } from '@/app/types/printer'

interface PrinterMetricsCardProps {
  printerName: string
  jobProgress: number
  layerCurrent: number | null
  layerTotal: number | null
  printerStatus: PrinterStatus | null
}

/** Formats seconds into a human-readable ETA string ("1h 23m" or "45m"). Returns "—" for null. */
function formatEta(seconds: number | null): string {
  if (seconds === null) return '—'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

/** Shows print progress, layer counts, and live hotend/bed temperatures from Moonraker. */
export function PrinterMetricsCard({
  printerName,
  jobProgress,
  layerCurrent,
  layerTotal,
  printerStatus,
}: PrinterMetricsCardProps) {
  return (
    <div className="p-5 rounded-xl border border-border bg-surface">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-muted">Printer</h3>
        <span className="font-mono text-xs text-teal">{printerName}</span>
      </div>

      <div className="mb-4">
        <div className="flex justify-between text-xs font-mono text-muted mb-1.5">
          <span>{jobProgress.toFixed(0)}%</span>
          {layerCurrent !== null && layerTotal !== null && (
            <span>Layer {layerCurrent} / {layerTotal}</span>
          )}
        </div>
        <ProgressBar value={jobProgress} height="md" />
      </div>

      <div className="grid grid-cols-3 gap-2">
        <MetricBox
          label="Hotend"
          value={printerStatus?.hotend_temp?.toFixed(1) ?? '—'}
          unit="°C"
        />
        <MetricBox
          label="Bed"
          value={printerStatus?.bed_temp?.toFixed(1) ?? '—'}
          unit="°C"
        />
        <MetricBox
          label="ETA"
          value={formatEta(printerStatus?.eta_seconds ?? null)}
        />
      </div>
    </div>
  )
}
