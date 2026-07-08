'use client'

import { usePrinter } from '@/app/contexts/PrinterContext'
import { PrinterCard } from './PrinterCard'
import type { PrinterWithStatus } from '@/app/types/printer'

interface PrinterGridProps {
  printers: PrinterWithStatus[]
}

export function PrinterGrid({ printers: initialPrinters }: PrinterGridProps) {
  const { selectedPrinter, setSelectedPrinter } = usePrinter()

  return (
    <section>
      <h2 className="text-xs font-semibold uppercase tracking-widest text-muted mb-3">
        Select Printer
      </h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {initialPrinters.map((printer) => (
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
