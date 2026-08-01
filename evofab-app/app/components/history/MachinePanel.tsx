// MachinePanel.tsx
// Side panel listing each machine involved in a pipeline run with a colored
// status dot and its current state.

import type { MachineStatusRow, MachineTelemetry } from './types'

interface MachinePanelProps {
  machines: MachineStatusRow[]
}

/** Condenses a machine's telemetry into one line ("42% · 210°C hotend · 60°C bed"), or null if there's nothing to show. */
function formatTelemetry(t?: MachineTelemetry): string | null {
  if (!t) return null
  const parts: string[] = []
  if (t.progress != null) parts.push(`${Math.round(t.progress)}%`)
  if (t.hotend_temp != null) parts.push(`${Math.round(t.hotend_temp)}°C hotend`)
  if (t.bed_temp != null) parts.push(`${Math.round(t.bed_temp)}°C bed`)
  return parts.length > 0 ? parts.join(' · ') : null
}

/** Compact machine status list shown alongside a pipeline run's progress tracker, with live telemetry (print progress/temps) when the machine reports it. */
export function MachinePanel({ machines }: MachinePanelProps) {
  return (
    <div className="rounded-xl border border-border bg-surface p-3.5">
      <h3 className="text-[11px] uppercase tracking-wide text-muted font-semibold mb-2.5">
        Machines
      </h3>
      {machines.map((m) => {
        const telemetryLine = formatTelemetry(m.telemetry)
        return (
          <div key={m.name} className="py-2 border-b border-border last:border-b-0">
            <div className="flex items-center gap-2.25">
              <span className={`w-2 h-2 rounded-full shrink-0 ${m.dotColorClass}`} />
              <span className="text-[12.5px] font-semibold text-text">{m.name}</span>
              <span className="ml-auto text-[11px] font-mono text-muted">{m.state}</span>
            </div>
            {telemetryLine && (
              <div className="text-[10.5px] font-mono text-muted mt-1 pl-4.25">{telemetryLine}</div>
            )}
          </div>
        )
      })}
    </div>
  )
}
