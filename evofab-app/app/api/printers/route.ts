import { NextResponse } from "next/server";
import { createClient } from "@/app/lib/supabase-server";
import { MoonrakerClient, getMoonrakerMode } from "@/app/lib/moonraker";
import type { PrinterStatus, PrinterWithStatus } from "@/app/types/printer";

function offlineStatus(printerId: string): PrinterStatus {
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

export async function GET() {
  const supabase = await createClient();
  const { data: printers, error } = await supabase
    .from("printers")
    .select("*")
    .eq("is_active", true)
    .order("name");

  if (error) {
    return NextResponse.json(
      {
        error: {
          code: "DATABASE_ERROR",
          message: "Unable to load printers.",
          retryable: true,
        },
      },
      { status: 500 },
    );
  }

  const results: PrinterWithStatus[] = await Promise.all(
    (printers ?? []).map(async (printer, index) => {
      let printerStatus: PrinterStatus;
      try {
        printerStatus = await new MoonrakerClient({
          printerId: printer.id,
          ip: printer.ip,
          port: printer.port,
        }).getStatus();
        if (getMoonrakerMode() === "mock" && index === 1) {
          printerStatus = {
            ...printerStatus,
            status: "printing",
            print_state: "printing",
            progress: 64,
            layer_current: 51,
            layer_total: 80,
            filename: "lattice_v7.gcode",
            hotend_temp: 234.2,
            hotend_target: 235,
            bed_temp: 79.4,
            bed_target: 80,
          };
        }
        if (getMoonrakerMode() === "mock" && index === 2)
          printerStatus = offlineStatus(printer.id);
      } catch {
        printerStatus = offlineStatus(printer.id);
      }

      return {
        id: printer.id,
        name: printer.name,
        model: printer.model,
        type: printer.type,
        material: printer.material,
        build_volume: printer.build_volume,
        is_active: printer.is_active,
        created_at: printer.created_at,
        printer_status: printerStatus,
      };
    }),
  );

  return NextResponse.json({ printers: results });
}
