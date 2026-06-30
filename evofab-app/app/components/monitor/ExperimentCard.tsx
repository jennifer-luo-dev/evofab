// ExperimentCard.tsx
// Monitor card displaying experiment parameters (pressure, cycles, script)
// as metric tiles.

import { MetricBox } from '@/app/components/ui/MetricBox'

interface ExperimentCardProps {
  pressure?: number | string | null
  cycles?: number | string | null
  script?: string
}

/** Displays experiment parameters (pressure, cycles, script) as metric tiles. */
export function ExperimentCard({
  pressure = '—',
  cycles = '—',
  script = '—',
}: ExperimentCardProps) {
  return (
    <div className="p-5 rounded-xl border border-border bg-surface">
      <h3 className="text-xs font-semibold uppercase tracking-widest text-muted mb-4">
        Experiment
      </h3>
      <div className="grid grid-cols-3 gap-2">
        <MetricBox label="Pressure" value={pressure ?? '—'} unit="kPa" />
        <MetricBox label="Cycles"   value={cycles   ?? '—'} />
        <MetricBox label="Script"   value={script} />
      </div>
    </div>
  )
}
