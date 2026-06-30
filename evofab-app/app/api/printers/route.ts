import { NextResponse } from "next/server";
import { createClient } from "@/app/lib/supabase-server";
import { parseMoonrakerStatus, offlinePrinterStatus } from "@/app/lib/moonraker";
import type { PrinterStatus, PrinterWithStatus } from "@/app/types/printer";

const MOONRAKER_TIMEOUT_MS = 3000;

/**
 * Polls a single Moonraker instance and maps the response to a PrinterStatus.
 * Falls back to offlinePrinterStatus if the request times out or the printer is unreachable.
 */
async function fetchMoonrakerStatus(
  ip: string,
  port: number,
  printerId: string,
): Promise<PrinterStatus> {
  const url = `http://${ip}:${port}/printer/objects/query?print_stats&extruder&heater_bed&virtual_sdcard`;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(MOONRAKER_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    return parseMoonrakerStatus(printerId, json.result?.status ?? {});
  } catch {
    return offlinePrinterStatus(printerId);
  }
}

/** GET /api/printers — Returns all active printers enriched with their live Moonraker statuses. */
export async function GET() {
  const supabase = await createClient();

  const { data: printers } = await supabase
    .from("printers")
    .select("*")
    .eq("is_active", true)
    .order("name");

  const results: PrinterWithStatus[] = await Promise.all(
    (printers ?? []).map(async (printer) => ({
      ...printer,
      printer_status: await fetchMoonrakerStatus(
        printer.ip,
        printer.port,
        printer.id,
      ),
    })),
  );

  return NextResponse.json({ printers: results });
}
