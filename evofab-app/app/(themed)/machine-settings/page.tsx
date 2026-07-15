// page.tsx (machine-settings)
// Machine Settings page: view configured machines grouped by machine type.

'use client'

import { useEffect, useState } from 'react'
import { MachineTypeSection } from '@/app/components/machine-settings/MachineTypeSection'
import type { MachineTypeConfig } from '@/app/components/machine-settings/types'

/**
 * Add/edit/delete machine type is visual-only here, matching the mockup this
 * was ported from — machine CRUD isn't implemented yet.
 */
export default function MachineSettingsPage() {
  const [machineTypes, setMachineTypes] = useState<MachineTypeConfig[]>([])

  useEffect(() => {
    fetch('/api/machine-settings')
      .then((res) => res.json())
      .then((data) => setMachineTypes(data.machineTypes ?? []))
  }, [])

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h1 className="text-xl font-semibold text-text mb-1">Machine Settings</h1>
          <p className="text-[13.5px] text-muted">
            Add, edit, or remove machines and machine types.
          </p>
        </div>
        <button
          type="button"
          className="px-3.75 py-2 rounded-lg text-xs font-semibold bg-teal text-bg shrink-0"
        >
          + Add Machine Type
        </button>
      </div>

      {machineTypes.map((type, i) => (
        <MachineTypeSection key={type.key} type={type} defaultOpen={i === 0} />
      ))}
    </div>
  )
}
