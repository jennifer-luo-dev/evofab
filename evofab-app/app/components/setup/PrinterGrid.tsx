'use client'

import { useState, useEffect } from 'react'
import { usePrinter } from '@/app/contexts/PrinterContext'
import { PrinterCard } from './PrinterCard'
import type { PrinterWithStatus } from '@/app/types/printer'

const POLL_INTERVAL_MS = 5000

interface PrinterGridProps {
  printers: PrinterWithStatus[]
}

export function PrinterGrid({ printers: initialPrinters }: PrinterGridProps) {
  const { selectedPrinter, setSelectedPrinter } = usePrinter()
  const [printers, setPrinters] = useState(initialPrinters)

  useEffect(() => {
    async function poll() {
      try {
        const res = await fetch('/api/printers')
        if (!res.ok) return
        const data = await res.json()
        setPrinters(data.printers)
      } catch {
        // keep showing last known state
      }
    }

    poll()
    const id = setInterval(poll, POLL_INTERVAL_MS)
    return () => clearInterval(id)
  }, [])

  return (
    <section>
      <h2 className="text-xs font-semibold uppercase tracking-widest text-[var(--color-muted)] mb-3">
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
