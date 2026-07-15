// MachinePanel.tsx
// Side panel listing each machine involved in a pipeline run with a colored
// status dot and its current state.

import type { MachineStatusRow } from './types'

interface MachinePanelProps {
  machines: MachineStatusRow[]
}

/** Compact machine status list shown alongside a pipeline run's progress tracker. */
export function MachinePanel({ machines }: MachinePanelProps) {
  return (
    <div className="rounded-xl border border-border bg-surface p-3.5">
      <h3 className="text-[11px] uppercase tracking-wide text-muted font-semibold mb-2.5">
        Machines
      </h3>
      {machines.map((m) => (
        <div
          key={m.name}
          className="flex items-center gap-2.25 py-2 border-b border-border last:border-b-0"
        >
          <span className={`w-2 h-2 rounded-full shrink-0 ${m.dotColorClass}`} />
          <span className="text-[12.5px] font-semibold text-text">{m.name}</span>
          <span className="ml-auto text-[11px] font-mono text-muted">{m.state}</span>
        </div>
      ))}
    </div>
  )
}
