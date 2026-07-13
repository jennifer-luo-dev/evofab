import type { Printer, PrinterStatus } from "@/app/types/printer";

export interface PrinterDriver {
  readStatus(printer: Printer): Promise<PrinterStatus>;
}

export interface PrinterUploadResult {
  outcome: PrinterControlOutcome;
  status: number | null;
  retryable: boolean;
  code?: PrinterDriverErrorCategory;
  path?: string;
}

export interface PrinterFileDriver extends PrinterDriver {
  readonly capabilities: ReadonlySet<
    "upload_file" | "verify_file" | "start_print"
  >;
  uploadFile(
    printer: Printer,
    file: File,
    path: string,
  ): Promise<PrinterUploadResult>;
  verifyStoredFile(
    printer: Printer,
    path: string,
  ): Promise<PrinterCommandResult>;
}

export type PrinterControlOutcome = "succeeded" | "failed" | "outcome_unknown";

export interface PrinterCommandResult {
  outcome: PrinterControlOutcome;
  status: number | null;
  retryable: boolean;
  code?:
    PrinterDriverErrorCategory | "PRUSALINK_NOT_FOUND" | "PRUSALINK_CONFLICT";
}

export type PrinterDriverErrorCategory =
  | "MOONRAKER_CHECKSUM_MISMATCH"
  | "MOONRAKER_CONFIG"
  | "MOONRAKER_MALFORMED_RESPONSE"
  | "MOONRAKER_NETWORK"
  | "MOONRAKER_NOT_FOUND"
  | "MOONRAKER_REJECTED"
  | "MOONRAKER_TIMEOUT"
  | "PRUSALINK_AUTH"
  | "PRUSALINK_CONFIG"
  | "PRUSALINK_MALFORMED_RESPONSE"
  | "PRUSALINK_NETWORK"
  | "PRUSALINK_NOT_FOUND"
  | "PRUSALINK_CONFLICT"
  | "PRUSALINK_SERVER"
  | "PRUSALINK_STORAGE_UNAVAILABLE"
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
