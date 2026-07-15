// MachineTable.tsx
// Table of configured machines for one machine type, plus an Active
// indicator and Edit/Delete row actions.

import type { MachineTypeConfig } from './types'

interface MachineTableProps {
  type: MachineTypeConfig
}

/**
 * Renders a machine type's rows. Edit/Delete links are visual-only, matching
 * the mockup this was ported from — neither is wired to a handler there
 * either, since machine CRUD isn't implemented yet.
 */
export function MachineTable({ type }: MachineTableProps) {
  return (
    <table className="w-full text-[12.5px]">
      <thead>
        <tr>
          {type.columns.map((col) => (
            <th
              key={col}
              className="text-left text-[11px] uppercase tracking-wide text-muted font-semibold py-2 px-1.5"
            >
              {col}
            </th>
          ))}
          <th className="text-left text-[11px] uppercase tracking-wide text-muted font-semibold py-2 px-1.5">
            Active
          </th>
          <th />
        </tr>
      </thead>
      <tbody>
        {type.rows.map((row, i) => (
          <tr key={i} className="border-t border-border">
            {row.map((cell, j) => (
              <td
                key={j}
                className={
                  j === row.length - 1 ? 'py-2.25 px-1.5 font-mono text-muted' : 'py-2.25 px-1.5'
                }
              >
                {cell}
              </td>
            ))}
            <td className="py-2.25 px-1.5">
              <span className="inline-block w-1.75 h-1.75 rounded-full bg-green mr-1.25" />
              Active
            </td>
            <td className="py-2.25 px-1.5">
              <div className="flex gap-3">
                <a className="text-teal text-xs font-semibold cursor-pointer">Edit</a>
                <a className="text-teal text-xs font-semibold cursor-pointer">Delete</a>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
