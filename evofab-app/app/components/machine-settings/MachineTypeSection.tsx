// MachineTypeSection.tsx
// Collapsible section for one machine type: header (icon, name, machine
// count) toggling a body that's either the machine table or an empty state.

'use client'

import { useState } from 'react'
import { cn } from '@/app/lib/utils'
import { MACHINE_TYPE_ICONS } from '@/app/components/ui/icons'
import { MachineTable } from './MachineTable'
import type { MachineTypeConfig } from './types'

interface MachineTypeSectionProps {
  type: MachineTypeConfig
  defaultOpen?: boolean
}

/** Accordion section listing every machine of one type, or an empty state if none are configured. */
export function MachineTypeSection({ type, defaultOpen = false }: MachineTypeSectionProps) {
  const [open, setOpen] = useState(defaultOpen)
  const Icon = MACHINE_TYPE_ICONS[type.key] ?? MACHINE_TYPE_ICONS.DEFAULT

  return (
    <div className="rounded-xl border border-border bg-surface mb-2.5 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2.5 px-4 py-3.5"
      >
        <span className="flex items-center justify-center w-7 h-7 rounded-lg bg-bg text-teal shrink-0">
          <Icon className="w-4 h-4" />
        </span>
        <span className="text-[13.5px] font-semibold text-text">{type.name}</span>
        <span className="text-xs text-muted">
          · {type.rows.length} machine{type.rows.length === 1 ? '' : 's'}
        </span>
        <span className={cn('ml-auto text-muted transition-transform', open && 'rotate-90')}>
          ›
        </span>
      </button>

      {open && (
        <div className="border-t border-border px-4 pb-3.5 pt-1">
          {type.rows.length === 0 ? (
            <div className="text-center py-6.5 px-2.5 text-muted text-[12.5px]">
              No machines added yet — add your first {type.name} to get started.
              <div className="mt-2.5">
                <button
                  type="button"
                  className="px-3.75 py-2 rounded-lg text-xs font-semibold bg-surface text-text border border-border"
                >
                  + Add Machine
                </button>
              </div>
            </div>
          ) : (
            <MachineTable type={type} />
          )}
        </div>
      )}
    </div>
  )
}
