import { createClient } from "@/app/lib/supabase-server";
import type {
  Printer,
  PrinterLoadedMaterial,
  PrinterStatus,
  PrinterWithStatus,
} from "@/app/types/printer";

export const STALE_STATUS_MS = 30_000;

export function toClientSafePrinter(
  printer: Printer,
  printerStatus: PrinterStatus,
  loadedMaterial: PrinterLoadedMaterial | null = null,
): PrinterWithStatus {
  return {
    id: printer.id,
    name: printer.name,
    model: printer.model,
    type: printer.type,
    material: printer.material,
    build_volume: printer.build_volume,
    webcam_url: printer.webcam_url,
    driver_type: printer.driver_type ?? "moonraker",
    is_active: printer.is_active,
    created_at: printer.created_at,
    printer_status: printerStatus,
    loaded_material: loadedMaterial,
  };
}

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
      toClientSafePrinter(printer, createOfflinePrinterStatus(printer.id)),
    ];
  }

  const supabase = await createClient();

  const [
    { data: printers, error: printersError },
    { data: statuses, error: statusesError },
    { data: loadouts, error: loadoutsError },
  ] = await Promise.all([
    supabase.from("printers").select("*").eq("is_active", true).order("name"),
    supabase.from("printer_status").select("*"),
    supabase.from("printer_material_loadout").select("printer_id,stock_id"),
  ]);

  if (printersError) {
    throw new Error(`Unable to load printers: ${printersError.message}`);
  }

  if (statusesError) {
    throw new Error(`Unable to load printer status: ${statusesError.message}`);
  }
  if (loadoutsError) {
    throw new Error(
      `Unable to load printer material loadouts: ${loadoutsError.message}`,
    );
  }

  const stockIds = (loadouts ?? []).map((loadout) => loadout.stock_id);
  const { data: stock, error: stockError } = stockIds.length
    ? await supabase
        .from("material_stock")
        .select("id,material_id,color,quantity,unit")
        .in("id", stockIds)
    : { data: [], error: null };
  if (stockError)
    throw new Error(`Unable to load material stock: ${stockError.message}`);
  const materialIds = (stock ?? []).map((lot) => lot.material_id);
  const { data: materials, error: materialsError } = materialIds.length
    ? await supabase.from("materials").select("id,name").in("id", materialIds)
    : { data: [], error: null };
  if (materialsError)
    throw new Error(
      `Unable to load loaded materials: ${materialsError.message}`,
    );
  const stockById = new Map((stock ?? []).map((lot) => [lot.id, lot]));
  const nameById = new Map(
    (materials ?? []).map((material) => [material.id, material.name]),
  );
  const loadoutByPrinter = new Map(
    (loadouts ?? []).flatMap((loadout) => {
      const lot = stockById.get(loadout.stock_id);
      const name = lot ? nameById.get(lot.material_id) : null;
      return lot && name
        ? [
            [
              loadout.printer_id,
              {
                material_name: name,
                color: lot.color,
                quantity: Number(lot.quantity),
                unit: lot.unit,
              },
            ],
          ]
        : [];
    }),
  );

  const statusMap = new Map(
    ((statuses as PrinterStatus[] | null) ?? []).map((status) => [
      status.printer_id,
      status,
    ]),
  );

  return ((printers as Printer[] | null) ?? []).map((printer) =>
    toClientSafePrinter(
      printer,
      statusForPrinter(printer.id, statusMap.get(printer.id)),
      loadoutByPrinter.get(printer.id) ?? null,
    ),
  );
}
