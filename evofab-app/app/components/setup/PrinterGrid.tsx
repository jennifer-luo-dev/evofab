// PrinterGrid.tsx
// Setup-flow grid of selectable printer cards, polling live status from
// each printer's Moonraker instance every 5 seconds.

'use client'

import { useState, useEffect } from 'react'
import { usePrinter } from '@/app/contexts/PrinterContext'
import { parseMoonrakerStatus, offlinePrinterStatus } from '@/app/lib/moonraker'
import { PrinterCard } from './PrinterCard'
import type { PrinterWithStatus } from '@/app/types/printer'

const POLL_INTERVAL_MS = 5000

/** Fetches live Moonraker status for a printer, falling back to an offline status on error. */
async function fetchLiveStatus(printer: PrinterWithStatus): Promise<PrinterWithStatus> {
  const url = `http://${printer.ip}:${printer.port}/printer/objects/query?print_stats&extruder&heater_bed&virtual_sdcard&display_status`
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = await res.json()
    return { ...printer, printer_status: parseMoonrakerStatus(printer.id, json.result?.status ?? {}) }
  } catch {
    return { ...printer, printer_status: offlinePrinterStatus(printer.id) }
  }
}

interface PrinterGridProps {
  printers: PrinterWithStatus[]
}

/** Grid of selectable printer cards, polling live status from Moonraker every 5 seconds. */
export function PrinterGrid({ printers: initialPrinters }: PrinterGridProps) {
  const { selectedPrinter, setSelectedPrinter } = usePrinter()
  const [printers, setPrinters] = useState(initialPrinters)

  useEffect(() => {
    async function poll() {
      const updated = await Promise.all(initialPrinters.map(fetchLiveStatus))
      setPrinters(updated)
    }

    poll()
    const id = setInterval(poll, POLL_INTERVAL_MS)
    return () => clearInterval(id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <section>
      <h2 className="text-xs font-semibold uppercase tracking-widest text-muted mb-3">
        Select Printer
      </h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {printers.map((printer) => (
          <PrinterCard
            key={printer.id}
            printer={printer}
            selected={selectedPrinter?.id === printer.id}
            onSelect={setSelectedPrinter}
          />
        ))}
      </div>
    </section>
  )
}
