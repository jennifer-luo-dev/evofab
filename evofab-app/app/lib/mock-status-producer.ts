// File purpose: Writes deterministic mock printer telemetry into Supabase.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getMoonrakerMode } from "@/app/lib/moonraker-config";
import { buildMockPrinterStatus } from "@/app/lib/mock-status-scenarios";
import type { Printer, PrinterStatus } from "@/app/types/printer";

export const DEFAULT_MOCK_STATUS_INTERVAL_MS = 2_000;
export const DEFAULT_MOCK_STATUS_SEED = "evofab-mock-status";

export interface MockStatusProducerOptions {
  supabase: MockStatusSupabaseClient;
  seed?: string;
  now?: Date;
  tick?: number;
}

export interface MockStatusProducerResult {
  tick: number;
  printerCount: number;
  statuses: PrinterStatus[];
}

type SupabaseQueryResult<T> = {
  data: T | null;
  error: { message: string } | null;
};

interface MockStatusSupabaseClient {
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

export function createScriptSupabaseClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export async function writeMockStatusTick(
  options: MockStatusProducerOptions,
): Promise<MockStatusProducerResult> {
  if (getMoonrakerMode() !== "mock") {
    throw new Error("Mock status producer only runs when MOONRAKER_MODE=mock.");
  }

  const tick = options.tick ?? 0;
  const now = options.now ?? new Date();
  const seed = options.seed ?? DEFAULT_MOCK_STATUS_SEED;
  const printerReader = options.supabase.from("printers") as PrinterReader;
  const { data: printers, error: printersError } = await printerReader
    .select("*")
    .eq("is_active", true)
    .order("name");

  if (printersError) {
    throw new Error(`Unable to load active printers: ${printersError.message}`);
  }

  const statuses = ((printers ?? []) as Printer[]).map(
    (printer) => buildMockPrinterStatus({ printer, tick, seed, now }).status,
  );

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
    printerCount: statuses.length,
    statuses,
  };
}

export function readMockProducerIntervalMs(): number {
  const value = Number(
    process.env.MOCK_STATUS_INTERVAL_MS ?? DEFAULT_MOCK_STATUS_INTERVAL_MS,
  );
  if (!Number.isFinite(value) || value <= 0)
    return DEFAULT_MOCK_STATUS_INTERVAL_MS;
  return Math.max(250, Math.floor(value));
}
