// File purpose: Polls real/mock Moonraker status into Supabase printer_status.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  MoonrakerStatusConnector,
  type PrinterStatusConnector,
} from "@/app/lib/moonraker-client";
import { MoonrakerError } from "@/app/lib/moonraker-errors";
import type { Printer, PrinterStatus } from "@/app/types/printer";

export const DEFAULT_STATUS_POLL_INTERVAL_MS = 2_000;
export const MIN_STATUS_POLL_INTERVAL_MS = 250;
export const STATUS_BACKOFF_MULTIPLIER = 3;

type SupabaseQueryResult<T> = {
  data: T | null;
  error: { message: string } | null;
};

interface StatusWorkerSupabaseClient {
  from(table: string): unknown;
}

type PrinterReader = {
  select(columns: string): {
    eq(
      column: string,
      value: unknown,
    ): {
      order(column: string): Promise<SupabaseQueryResult<Printer[]>>;
    };
  };
};

type PrinterStatusWriter = {
  upsert(
    rows: PrinterStatus[],
    options: { onConflict: string },
  ): Promise<SupabaseQueryResult<PrinterStatus[]>>;
};

export interface StatusWorkerPrinterResult {
  printerId: string;
  printerName: string;
  ok: boolean;
  skipped: boolean;
  status?: PrinterStatus["status"];
  errorCode?: string;
  retryable?: boolean;
  backoffUntil?: string;
}

export interface StatusWorkerTickResult {
  tick: number;
  printerCount: number;
  upsertCount: number;
  results: StatusWorkerPrinterResult[];
}

export interface StatusWorkerOptions {
  supabase: StatusWorkerSupabaseClient;
  connector?: PrinterStatusConnector;
  tick?: number;
  now?: Date;
  intervalMs?: number;
  backoffState?: Map<string, number>;
}

export function readStatusWorkerIntervalMs(): number {
  const value = Number(
    process.env.STATUS_POLL_INTERVAL_MS ?? DEFAULT_STATUS_POLL_INTERVAL_MS,
  );
  if (!Number.isFinite(value) || value <= 0) {
    return DEFAULT_STATUS_POLL_INTERVAL_MS;
  }
  return Math.max(MIN_STATUS_POLL_INTERVAL_MS, Math.floor(value));
}

export function createStatusWorkerConnector(): PrinterStatusConnector {
  return new MoonrakerStatusConnector();
}

export function createStatusWorkerBackoffState(): Map<string, number> {
  return new Map();
}

export async function writeStatusWorkerTick(
  options: StatusWorkerOptions,
): Promise<StatusWorkerTickResult> {
  const tick = options.tick ?? 0;
  const now = options.now ?? new Date();
  const intervalMs = options.intervalMs ?? DEFAULT_STATUS_POLL_INTERVAL_MS;
  const backoffState = options.backoffState ?? createStatusWorkerBackoffState();
  const connector = options.connector ?? createStatusWorkerConnector();
  const printerReader = options.supabase.from("printers") as PrinterReader;
  const { data: printers, error: printersError } = await printerReader
    .select("*")
    .eq("is_active", true)
    .order("name");

  if (printersError) {
    throw new Error(`Unable to load active printers: ${printersError.message}`);
  }

  const activePrinters = (printers ?? []) as Printer[];
  const statuses: PrinterStatus[] = [];
  const results: StatusWorkerPrinterResult[] = [];

  for (const printer of activePrinters) {
    const backoffUntilMs = backoffState.get(printer.id) ?? 0;
    if (backoffUntilMs > now.getTime()) {
      results.push({
        printerId: printer.id,
        printerName: printer.name,
        ok: false,
        skipped: true,
        retryable: true,
        backoffUntil: new Date(backoffUntilMs).toISOString(),
      });
      continue;
    }

    try {
      const status = await connector.readStatus(printer);
      backoffState.delete(printer.id);
      statuses.push(status);
      results.push({
        printerId: printer.id,
        printerName: printer.name,
        ok: true,
        skipped: false,
        status: status.status,
      });
    } catch (error) {
      const normalized =
        error instanceof MoonrakerError
          ? error
          : new MoonrakerError({
              code: "MOONRAKER_OFFLINE",
              message:
                error instanceof Error
                  ? error.message
                  : "Moonraker status poll failed.",
              printerId: printer.id,
              retryable: true,
            });
      const shouldBackoff =
        normalized.code === "MOONRAKER_OFFLINE" ||
        normalized.code === "MOONRAKER_TIMEOUT";
      const nextBackoffUntilMs = shouldBackoff
        ? now.getTime() + intervalMs * STATUS_BACKOFF_MULTIPLIER
        : undefined;

      if (nextBackoffUntilMs) {
        backoffState.set(printer.id, nextBackoffUntilMs);
      }

      results.push({
        printerId: printer.id,
        printerName: printer.name,
        ok: false,
        skipped: false,
        errorCode: normalized.code,
        retryable: normalized.retryable,
        backoffUntil: nextBackoffUntilMs
          ? new Date(nextBackoffUntilMs).toISOString()
          : undefined,
      });
    }
  }

  if (statuses.length > 0) {
    const printerStatusWriter = options.supabase.from(
      "printer_status",
    ) as PrinterStatusWriter;
    const { error: upsertError } = await printerStatusWriter.upsert(statuses, {
      onConflict: "printer_id",
    });

    if (upsertError) {
      throw new Error(`Unable to write printer status: ${upsertError.message}`);
    }
  }

  return {
    tick,
    printerCount: activePrinters.length,
    upsertCount: statuses.length,
    results,
  };
}

export type StatusWorkerSupabase = SupabaseClient | StatusWorkerSupabaseClient;
