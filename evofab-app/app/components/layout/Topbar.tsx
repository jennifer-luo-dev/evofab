"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/app/lib/supabase";
import type { PrinterStatusType } from "@/app/types/printer";
import {
  buildPrinterIndicators,
  type PrinterIndicator,
  type TopbarPrinter,
  type TopbarPrinterStatus,
} from "@/app/lib/topbar-printer-indicators";

interface DeviceIndicator {
  label: string;
  status: PrinterStatusType;
  printerId?: string;
}

const statusColor: Record<PrinterStatusType, string> = {
  idle: "bg-green",
  printing: "bg-amber animate-pulse-dot",
  paused: "bg-amber",
  error: "bg-red",
  offline: "bg-muted",
};

export function Topbar() {
  const [printers, setPrinters] = useState<PrinterIndicator[]>([]);
  const [controlError, setControlError] = useState<string | null>(null);

  const activePrinterId = useMemo(() => {
    return (
      printers.find((printer) =>
        ["printing", "paused", "error"].includes(printer.status),
      )?.printerId ?? null
    );
  }, [printers]);

  useEffect(() => {
    const supabase = createClient();

    async function loadPrinters() {
      const [{ data: printerRows }, { data: statusRows }] = await Promise.all([
        supabase
          .from("printers")
          .select("id, name, model, type")
          .eq("is_active", true)
          .order("name"),
        supabase.from("printer_status").select("printer_id, status"),
      ]);

      setPrinters(
        buildPrinterIndicators(
          (printerRows as TopbarPrinter[] | null) ?? [],
          (statusRows as TopbarPrinterStatus[] | null) ?? [],
        ),
      );
    }

    void loadPrinters();

    const channel = supabase
      .channel("topbar-printer-status")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "printer_status" },
        (payload) => {
          const updated = payload.new as {
            printer_id?: string;
            status?: PrinterStatusType;
          };
          if (!updated.printer_id || !updated.status) return;

          setPrinters((current) =>
            current.map((printer) =>
              printer.printerId === updated.printer_id
                ? { ...printer, status: updated.status as PrinterStatusType }
                : printer,
            ),
          );
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);

  async function triggerEmergencyStop() {
    if (!activePrinterId) return;
    setControlError(null);

    const response = await fetch(`/api/printers/${activePrinterId}/control`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "emergency_stop" }),
    });
    const body = await response.json().catch(() => null);

    if (!response.ok) {
      setControlError(body?.error?.message ?? "Software e-stop failed.");
    }
  }

  const devices: DeviceIndicator[] = [
    ...printers,
    { label: "UR7e", status: "idle" },
    { label: "Camera", status: "idle" },
  ];

  return (
    <header className="fixed top-0 left-0 right-0 z-50 h-13 flex items-center justify-between px-6 bg-surface border-b border-border">
      <div className="flex items-center gap-3">
        <span className="font-mono text-teal text-sm font-bold tracking-wider">
          EVOFAB
        </span>
        <span className="text-border-2 text-lg select-none">/</span>
        <span className="font-mono text-muted text-xs tracking-wide">SDL</span>
        <div className="w-px h-4 bg-border-2 mx-2" />
        <span className="text-xs text-muted">
          Nemitz Robotics Lab · Tufts ME
        </span>
      </div>

      <div className="flex items-center gap-4">
        <button
          onClick={triggerEmergencyStop}
          disabled={!activePrinterId}
          title={
            activePrinterId ? "Trigger software e-stop" : "No active printer"
          }
          className="rounded-md border border-red/50 bg-red/10 px-3 py-1.5 text-xs font-semibold text-red transition-colors hover:bg-red/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          software e-stop
        </button>
        {controlError && (
          <span
            className="max-w-52 truncate text-xs text-red"
            title={controlError}
          >
            {controlError}
          </span>
        )}
        {devices.map((device) => (
          <div key={device.label} className="flex items-center gap-1.5">
            <span
              className={`inline-block w-2 h-2 rounded-full ${statusColor[device.status]}`}
            />
            <span className="font-mono text-xs text-muted">{device.label}</span>
          </div>
        ))}
      </div>
    </header>
  );
}
