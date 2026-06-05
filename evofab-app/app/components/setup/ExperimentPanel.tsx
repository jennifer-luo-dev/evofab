'use client'

import { cn } from '@/app/lib/utils'
import { usePrinter } from '@/app/contexts/PrinterContext'
import type { Experiment } from '@/app/types/job'

interface ExperimentPanelProps {
  experiments: Experiment[]
}

export function ExperimentPanel({ experiments }: ExperimentPanelProps) {
  const { selectedExperiment, setSelectedExperiment, experimentParams, updateExperimentParam } = usePrinter()

  return (
    <section>
      <h2 className="text-xs font-semibold uppercase tracking-widest text-[var(--color-muted)] mb-3">
        Experiment
      </h2>
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {experiments.map((exp) => (
            <button
              key={exp.id}
              onClick={() => setSelectedExperiment(exp)}
              className={cn(
                'text-left p-4 rounded-xl border transition-all duration-150',
                'bg-[var(--color-surface)] hover:bg-[var(--color-surface-2)]',
                selectedExperiment?.id === exp.id
                  ? 'border-[var(--color-teal)] bg-[var(--color-teal-dim)]'
                  : 'border-[var(--color-border)] hover:border-[var(--color-border-2)]'
              )}
            >
              <p className="text-sm font-semibold text-[var(--color-text)]">{exp.display_name}</p>
              {exp.description && (
                <p className="text-xs text-[var(--color-muted)] mt-1 leading-relaxed">{exp.description}</p>
              )}
            </button>
          ))}
        </div>

        {selectedExperiment && Object.keys(selectedExperiment.param_schema?.properties ?? {}).length > 0 && (
          <div className="p-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] animate-fade-up">
            <p className="text-[10px] uppercase tracking-wider text-[var(--color-muted)] mb-3">
              Parameters · {selectedExperiment.display_name}
            </p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {Object.entries(selectedExperiment.param_schema.properties).map(([key, schema]) => (
                <div key={key} className="flex flex-col gap-1">
                  <label className="text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
                    {schema.title}
                  </label>
                  <input
                    type="number"
                    min={schema.minimum}
                    max={schema.maximum}
                    value={String(experimentParams[key] ?? selectedExperiment.default_params[key] ?? '')}
                    onChange={(e) => updateExperimentParam(key, Number(e.target.value))}
                    className="font-mono text-sm bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-[var(--color-text)] focus:outline-none focus:border-[var(--color-teal)] transition-colors"
                  />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
