import { NextResponse } from "next/server";
import { createClient } from "@/app/lib/supabase-server";
import type { PrinterStatus, PrinterWithStatus, PrinterStatusType } from "@/app/types/printer";

const MOONRAKER_TIMEOUT_MS = 3000;

const STATE_MAP: Record<string, PrinterStatusType> = {
  standby: "idle",
  printing: "printing",
  paused: "paused",
  error: "error",
  complete: "idle",
  cancelled: "idle",
};

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
    const status = json.result?.status ?? {};
    const ps = status.print_stats ?? {};
    const ext = status.extruder ?? {};
    const bed = status.heater_bed ?? {};
    const vsd = status.virtual_sdcard ?? {};

    return {
      printer_id: printerId,
      online: true,
      status: STATE_MAP[ps.state] ?? "idle",
      print_state: ps.state ?? null,
      filename: ps.filename || null,
      progress: typeof vsd.progress === "number" ? vsd.progress * 100 : 0,
      layer_current: ps.info?.current_layer ?? null,
      layer_total: ps.info?.total_layer ?? null,
      hotend_temp: ext.temperature ?? null,
      hotend_target: ext.target ?? null,
      bed_temp: bed.temperature ?? null,
      bed_target: bed.target ?? null,
      eta_seconds: null,
      updated_at: new Date().toISOString(),
    };
  } catch {
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
      updated_at: new Date().toISOString(),
    };
  }
}

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
