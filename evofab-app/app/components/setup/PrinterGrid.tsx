'use client'

import { useState, useEffect } from 'react'
import { usePrinter } from '@/app/contexts/PrinterContext'
import { PrinterCard } from './PrinterCard'
import type { PrinterWithStatus, PrinterStatus, PrinterStatusType } from '@/app/types/printer'

const POLL_INTERVAL_MS = 5000

const STATE_MAP: Record<string, PrinterStatusType> = {
  standby: 'idle',
  printing: 'printing',
  paused: 'paused',
  error: 'error',
  complete: 'idle',
  cancelled: 'idle',
}

async function fetchLiveStatus(printer: PrinterWithStatus): Promise<PrinterWithStatus> {
  const url = `http://${printer.ip}:${printer.port}/printer/objects/query?print_stats&extruder&heater_bed&virtual_sdcard`
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = await res.json()
    const s = json.result?.status ?? {}
    const ps = s.print_stats ?? {}
    const ext = s.extruder ?? {}
    const bed = s.heater_bed ?? {}
    const vsd = s.virtual_sdcard ?? {}

    const status: PrinterStatus = {
      printer_id: printer.id,
      online: true,
      status: STATE_MAP[ps.state] ?? 'idle',
      print_state: ps.state ?? null,
      filename: ps.filename || null,
      progress: typeof vsd.progress === 'number' ? vsd.progress * 100 : 0,
      layer_current: ps.info?.current_layer ?? null,
      layer_total: ps.info?.total_layer ?? null,
      hotend_temp: ext.temperature ?? null,
      hotend_target: ext.target ?? null,
      bed_temp: bed.temperature ?? null,
      bed_target: bed.target ?? null,
      eta_seconds: null,
      updated_at: new Date().toISOString(),
    }
    return { ...printer, printer_status: status }
  } catch {
    const status: PrinterStatus = {
      printer_id: printer.id,
      online: false,
      status: 'offline',
      print_state: null,
      filename: null,
      progress: 0,
      layer_current: null,
      layer_total: null,
      hotend_temp: null,
      hotend_target: null,
      bed_temp: null,
      bed_target: null,
      eta_seconds: null,
      updated_at: new Date().toISOString(),
    }
    return { ...printer, printer_status: status }
  }
}

interface PrinterGridProps {
  printers: PrinterWithStatus[]
}

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
