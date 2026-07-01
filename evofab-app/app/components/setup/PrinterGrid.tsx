"use client";

import { useState, useEffect } from "react";
import { usePrinter } from "@/app/contexts/PrinterContext";
import { PrinterCard } from "./PrinterCard";
import type { PrinterWithStatus } from "@/app/types/printer";

const POLL_INTERVAL_MS = 5000;

async function fetchLivePrinters(): Promise<PrinterWithStatus[] | null> {
  try {
    const response = await fetch("/api/printers", {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;
    const json = await response.json();
    return json.printers ?? null;
  } catch {
    return null;
  }
}

interface PrinterGridProps {
  printers: PrinterWithStatus[];
}

export function PrinterGrid({ printers: initialPrinters }: PrinterGridProps) {
  const { selectedPrinter, setSelectedPrinter } = usePrinter();
  const [printers, setPrinters] = useState(initialPrinters);

  useEffect(() => {
    async function poll() {
      const updated = await fetchLivePrinters();
      if (updated) setPrinters(updated);
    }

    poll();
    const id = setInterval(poll, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

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
  );
}
