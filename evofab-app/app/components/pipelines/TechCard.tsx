// TechCard.tsx
// Selectable card representing one technology in the Pipelines technology
// selection grid.

'use client';

import { cn } from '@/app/lib/utils';
import { MACHINE_TYPE_ICONS } from '@/app/components/ui/icons';
import type { TechOption } from './types';

interface TechCardProps {
  tech: TechOption;
  selected: boolean;
  onToggle: (key: TechOption['key']) => void;
}

/** Selectable card for one technology, toggled on/off for the pipeline being built. */
export function TechCard({ tech, selected, onToggle }: TechCardProps) {
  const Icon = MACHINE_TYPE_ICONS[tech.key] ?? MACHINE_TYPE_ICONS.DEFAULT;

  return (
    <button
      type="button"
      onClick={() => onToggle(tech.key)}
      aria-pressed={selected}
      className={cn(
        'flex items-start gap-3 p-4 rounded-xl border-[1.5px] text-left transition-colors',
        'bg-surface hover:bg-surface-2',
        selected ? 'border-teal bg-teal-dim' : 'border-border hover:border-border-2'
      )}
    >
      <span
        className={cn(
          'flex items-center justify-center w-8.5 h-8.5 rounded-lg shrink-0 text-teal',
          selected ? 'bg-surface' : 'bg-bg'
        )}
      >
        <Icon className="w-4 h-4" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-text mb-0.5">{tech.name}</span>
        {tech.desc && <span className="block text-xs text-muted leading-relaxed">{tech.desc}</span>}
      </span>
      <span
        className={cn(
          'ml-auto flex items-center justify-center w-4.5 h-4.5 rounded-[5px] border-[1.5px] shrink-0',
          selected ? 'bg-teal border-teal' : 'border-border'
        )}
      >
        {selected && (
          <svg width="11" height="11" viewBox="0 0 16 16">
            <path
              d="M3 8.5 L6.5 12 L13 4"
              stroke="white"
              strokeWidth="2"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </span>
    </button>
  );
}
