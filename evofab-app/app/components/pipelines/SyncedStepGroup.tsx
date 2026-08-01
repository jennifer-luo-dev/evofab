// SyncedStepGroup.tsx
// Wraps two or more PipelineStepRows that run simultaneously, with a "synced"
// label above them and an optional unsync action. Used by both the pipeline
// builder and the read-only History progress tracker.

import type { ReactNode } from 'react';
import { LinkIcon } from '@/app/components/ui/icons';

interface SyncedStepGroupProps {
  onUnsync?: () => void;
  children: ReactNode;
}

/**
 * Labeled bracket around the step rows belonging to one sync group. No longer takes a single
 * `stepNumber` — synced steps each keep their own distinct display number (see
 * `deriveStepFields`), so this only needs to convey "these run together," not which numbers.
 */
export function SyncedStepGroup({ onUnsync, children }: SyncedStepGroupProps) {
  return (
    <div>
      <div className="flex items-center gap-1.25 mt-1.5 mb-1 ml-0.5 text-[11px] font-semibold text-teal">
        <LinkIcon className="w-3 h-3" />
        <span className="inline-flex items-center px-2 py-px rounded-full bg-teal-dim border border-teal">
          Synced
        </span>
        {onUnsync && (
          <button
            type="button"
            onClick={onUnsync}
            className="ml-1.5 text-muted underline font-semibold"
          >
            Unsync
          </button>
        )}
      </div>
      <div className="flex flex-col gap-0.75 border-l-2 border-dashed border-teal pl-2 ml-1.5">
        {children}
      </div>
    </div>
  );
}
