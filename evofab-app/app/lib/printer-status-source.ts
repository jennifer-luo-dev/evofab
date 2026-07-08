import { createClient } from "@/app/lib/supabase-server";
import type {
  Printer,
  PrinterStatus,
  PrinterWithStatus,
} from "@/app/types/printer";

export const STALE_STATUS_MS = 30_000;

export function createOfflinePrinterStatus(printerId: string): PrinterStatus {
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
    fault_message: null,
    fault_mcu: null,
    updated_at: new Date().toISOString(),
  };
}

function isFreshStatus(status: PrinterStatus): boolean {
  const updatedAtMs = Date.parse(status.updated_at);

  if (!Number.isFinite(updatedAtMs)) {
    return false;
  }

  return Date.now() - updatedAtMs <= STALE_STATUS_MS;
}

function statusForPrinter(
  printerId: string,
  status: PrinterStatus | undefined,
): PrinterStatus {
  if (!status || !isFreshStatus(status)) {
    return createOfflinePrinterStatus(printerId);
  }

  return status;
}

export async function getActivePrintersWithStatus(): Promise<
  PrinterWithStatus[]
> {
  if (process.env.EVOFAB_E2E_MOCK_SUPABASE === "1") {
    const printer: Printer = {
      id: "printer-fgf",
      name: "FGF Printer",
      model: "FGF Printer",
      ip: "127.0.0.1",
      port: 7125,
      type: "FGF",
      material: "PLA",
      build_volume: "300x300x400mm",
      webcam_url: null,
      is_active: true,
      created_at: "2026-07-08T00:00:00.000Z",
    };
    return [
      { ...printer, printer_status: createOfflinePrinterStatus(printer.id) },
    ];
  }

  const supabase = await createClient();

  const [
    { data: printers, error: printersError },
    { data: statuses, error: statusesError },
  ] = await Promise.all([
    supabase.from("printers").select("*").eq("is_active", true).order("name"),
    supabase.from("printer_status").select("*"),
  ]);

  if (printersError) {
    throw new Error(`Unable to load printers: ${printersError.message}`);
  }

  if (statusesError) {
    throw new Error(`Unable to load printer status: ${statusesError.message}`);
  }

  const statusMap = new Map(
    ((statuses as PrinterStatus[] | null) ?? []).map((status) => [
      status.printer_id,
      status,
    ]),
  );

  return ((printers as Printer[] | null) ?? []).map((printer) => ({
    ...printer,
    printer_status: statusForPrinter(printer.id, statusMap.get(printer.id)),
  }));
}
