import type { Printer, PrinterStatus } from "@/app/types/printer";

export interface PrinterDriver {
  readStatus(printer: Printer): Promise<PrinterStatus>;
}

export type PrinterDriverErrorCategory =
  | "PRUSALINK_AUTH"
  | "PRUSALINK_CONFIG"
  | "PRUSALINK_MALFORMED_RESPONSE"
  | "PRUSALINK_NETWORK"
  | "PRUSALINK_SERVER"
  | "PRUSALINK_TIMEOUT";

export function offlinePrinterStatus(
  printerId: string,
  category: PrinterDriverErrorCategory,
  now = new Date(),
): PrinterStatus {
  return {
    printer_id: printerId,
    online: false,
    status: "offline",
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
    progress_source: "unknown",
    layer_source: "unknown",
    fault_message: category,
    fault_mcu: null,
    updated_at: now.toISOString(),
  };
}
