// TechSelectionGrid.tsx
// Grid of TechCards for picking which technologies a pipeline needs, before
// moving into the step builder.

'use client'

import { TechCard } from './TechCard'
import { usePipelineConfig } from './PipelineConfigContext'
import type { TechKey } from './types'

interface TechSelectionGridProps {
  selected: Set<TechKey>
  onToggle: (key: TechKey) => void
}

/** Grid of selectable technology cards used to scope which machines a pipeline can use. */
export function TechSelectionGrid({ selected, onToggle }: TechSelectionGridProps) {
  const { techs } = usePipelineConfig()
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {techs.map((tech) => (
        <TechCard
          key={tech.key}
          tech={tech}
          selected={selected.has(tech.key)}
          onToggle={onToggle}
        />
      ))}
    </div>
  )
}
