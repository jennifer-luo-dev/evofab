// route.ts (api/printers)
// Returns active `printer`-type machines (`machines` joined with their
// `machine_printer` detail row — see machine_types.table_name in
// evofab-app/supabase/schema.sql) enriched with live status polled directly
// from each machine's Moonraker instance. There is no dedicated `printers`
// table in the current schema; printers are just machines of type `printer`.

import { NextResponse } from "next/server";
import { createClient } from "@/app/lib/supabase-server";
import { parseMoonrakerStatus, offlinePrinterStatus } from "@/app/lib/moonraker";
import type { PrinterStatus, PrinterType, PrinterWithStatus } from "@/app/types/printer";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

const MOONRAKER_TIMEOUT_MS = 3000;
/** Falls back to Moonraker's default port when a machine row has none set. */
const DEFAULT_MOONRAKER_PORT = 7125;

/** Maps a live-polled PrinterStatus onto `machine_status`'s narrower status enum ('printing' -> 'busy'). */
const MACHINE_STATUS_MAP: Record<PrinterStatus["status"], string> = {
  idle: "idle",
  printing: "busy",
  paused: "paused",
  error: "error",
  offline: "offline",
};

/**
 * Upserts this machine's live status into `machine_status` so other views (e.g. the History
 * page's per-run machine panel and live step monitor) reflect reality without needing their own
 * Moonraker polling. Stores the full `PrinterStatus` as telemetry — not just a few fields — so
 * a consumer like `PrinterMetricsCard` can be driven directly off it. Best-effort — a failure
 * here shouldn't break the printer list response.
 */
async function syncMachineStatus(supabase: SupabaseServerClient, machineId: string, status: PrinterStatus) {
  await supabase
    .from("machine_status")
    .upsert(
      {
        machine_id: machineId,
        online: status.online,
        status: MACHINE_STATUS_MAP[status.status],
        telemetry: status,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "machine_id" }
    )
    .then(({ error }) => {
      if (error) console.error("Failed to sync machine_status", error.message);
    });
}

interface MachinePrinterDetail {
  machine_id: string;
  model: string;
  printer_type: string;
  material: string | null;
  build_volume: string | null;
}

/**
 * Polls a single Moonraker instance and maps the response to a PrinterStatus.
 * Falls back to offlinePrinterStatus if the request times out or the printer is unreachable.
 */
async function fetchMoonrakerStatus(
  ip: string,
  port: number,
  printerId: string,
): Promise<PrinterStatus> {
  const url = `http://${ip}:${port}/printer/objects/query?print_stats&extruder&heater_bed&virtual_sdcard&display_status`;
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

/** GET /api/printers — Returns all active `printer`-type machines enriched with their live Moonraker statuses. */
export async function GET() {
  const supabase = await createClient();

  const { data: types, error: typesError } = await supabase
    .from("machine_types")
    .select("id, type_key");
  if (typesError) return NextResponse.json({ error: typesError.message }, { status: 500 });

  const printerType = (types ?? []).find((t) => t.type_key === "printer");
  if (!printerType) return NextResponse.json({ printers: [] });

  const { data: machines, error: machinesError } = await supabase
    .from("machines")
    .select("id, name, ip, port, is_active, created_at")
    .eq("machine_type_id", printerType.id)
    .eq("is_active", true)
    .order("name");
  if (machinesError) return NextResponse.json({ error: machinesError.message }, { status: 500 });

  const machineIds = (machines ?? []).map((m) => m.id);
  const { data: details, error: detailsError } =
    machineIds.length > 0
      ? await supabase.from("machine_printer").select("*").in("machine_id", machineIds)
      : { data: [] as MachinePrinterDetail[], error: null };
  if (detailsError) return NextResponse.json({ error: detailsError.message }, { status: 500 });

  const detailsByMachineId = new Map((details ?? []).map((d) => [d.machine_id, d as MachinePrinterDetail]));

  const results: PrinterWithStatus[] = await Promise.all(
    (machines ?? []).map(async (m) => {
      const detail = detailsByMachineId.get(m.id);
      const port = m.port ?? DEFAULT_MOONRAKER_PORT;
      const printer_status = m.ip
        ? await fetchMoonrakerStatus(m.ip, port, m.id)
        : offlinePrinterStatus(m.id);
      await syncMachineStatus(supabase, m.id, printer_status);
      return {
        id: m.id,
        name: m.name,
        model: detail?.model ?? "",
        ip: m.ip ?? "",
        port,
        type: (detail?.printer_type as PrinterType) ?? "FDM",
        material: detail?.material ?? null,
        build_volume: detail?.build_volume ?? null,
        is_active: m.is_active,
        created_at: m.created_at,
        printer_status,
      };
    }),
  );

  return NextResponse.json({ printers: results });
}
