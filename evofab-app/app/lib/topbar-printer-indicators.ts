import type { Printer, PrinterStatusType } from "@/app/types/printer";

export interface PrinterIndicator {
  label: string;
  status: PrinterStatusType;
  printerId: string;
}

export type TopbarPrinter = Pick<Printer, "id" | "name" | "model" | "type">;

export interface TopbarPrinterStatus {
  printer_id: string;
  status: PrinterStatusType;
}

export function displayPrinterName(
  printer: Pick<Printer, "name" | "model" | "type">,
): string {
  if (printer.name === "EvoFab Sovol Zero") return "FDM Printer";
  if (printer.name === "Printer H") return "FGF Printer";
  return printer.name;
}

export function buildPrinterIndicators(
  printers: TopbarPrinter[],
  statuses: TopbarPrinterStatus[],
): PrinterIndicator[] {
  const statusByPrinter = new Map(
    statuses.map((status) => [status.printer_id, status.status]),
  );

  return printers.map((printer) => ({
    label: displayPrinterName(printer),
    printerId: printer.id,
    status: statusByPrinter.get(printer.id) ?? "offline",
  }));
}
