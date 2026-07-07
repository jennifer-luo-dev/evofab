import assert from "node:assert/strict";
import test from "node:test";
import {
  readStatusWorkerIntervalMs,
  writeStatusWorkerTick,
} from "../app/lib/status-worker";
import { MoonrakerError } from "../app/lib/moonraker-errors";
import type { Printer, PrinterStatus } from "../app/types/printer";

function printer(input: Partial<Printer> & Pick<Printer, "id" | "name">): Printer {
  return {
    id: input.id,
    name: input.name,
    model: input.model ?? "Mock",
    ip: input.ip ?? "127.0.0.1",
    port: input.port ?? 7125,
    type: input.type ?? "FDM",
    material: input.material ?? null,
    build_volume: input.build_volume ?? null,
    is_active: input.is_active ?? true,
    created_at: input.created_at ?? "2026-07-01T00:00:00.000Z",
  };
}

function statusFor(printerId: string, updatedAt: string): PrinterStatus {
  return {
    printer_id: printerId,
    online: true,
    status: "idle",
    print_state: "standby",
    filename: null,
    progress: 0,
    layer_current: null,
    layer_total: null,
    hotend_temp: 31,
    hotend_target: 0,
    bed_temp: 27,
    bed_target: 0,
    eta_seconds: null,
    progress_source: "estimated",
    layer_source: "unknown",
    fault_message: null,
    fault_mcu: null,
    updated_at: updatedAt,
  };
}

function createMockSupabase(activePrinters: Printer[]) {
  const upserts: PrinterStatus[][] = [];

  return {
    upserts,
    supabase: {
      from(table: string) {
        if (table === "printers") {
          return {
            select() {
              return {
                eq() {
                  return {
                    async order() {
                      return { data: activePrinters, error: null };
                    },
                  };
                },
              };
            },
          };
        }

        if (table === "printer_status") {
          return {
            async upsert(rows: PrinterStatus[]) {
              upserts.push(rows);
              return { data: rows, error: null };
            },
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      },
    },
  };
}

test("status worker writes normalized connector rows for active printers", async () => {
  const activePrinters = [
    printer({ id: "printer-1", name: "Alpha" }),
    printer({ id: "printer-2", name: "Beta" }),
  ];
  const { supabase, upserts } = createMockSupabase(activePrinters);
  const now = new Date("2026-07-01T12:00:00.000Z");
  const connector = {
    async readStatus(input: Printer) {
      return statusFor(input.id, now.toISOString());
    },
  };

  const result = await writeStatusWorkerTick({
    supabase,
    connector,
    tick: 7,
    now,
  });

  assert.equal(result.tick, 7);
  assert.equal(result.printerCount, 2);
  assert.equal(result.upsertCount, 2);
  assert.deepEqual(
    upserts[0].map((row) => row.printer_id),
    ["printer-1", "printer-2"],
  );
  assert.ok(result.results.every((item) => item.ok && !item.skipped));
});

test("status worker backs off retryable offline errors without upserting", async () => {
  const activePrinters = [printer({ id: "printer-1", name: "Alpha" })];
  const { supabase, upserts } = createMockSupabase(activePrinters);
  const backoffState = new Map<string, number>();
  const calls: string[] = [];
  const connector = {
    async readStatus(input: Printer) {
      calls.push(input.id);
      throw new MoonrakerError({
        code: "MOONRAKER_TIMEOUT",
        message: "Moonraker request timed out.",
        printerId: input.id,
        retryable: true,
      });
    },
  };

  const first = await writeStatusWorkerTick({
    supabase,
    connector,
    now: new Date("2026-07-01T12:00:00.000Z"),
    intervalMs: 2_000,
    backoffState,
  });
  const second = await writeStatusWorkerTick({
    supabase,
    connector,
    now: new Date("2026-07-01T12:00:01.000Z"),
    intervalMs: 2_000,
    backoffState,
  });

  assert.equal(calls.length, 1);
  assert.equal(upserts.length, 0);
  assert.equal(first.results[0].errorCode, "MOONRAKER_TIMEOUT");
  assert.equal(first.results[0].backoffUntil, "2026-07-01T12:00:06.000Z");
  assert.equal(second.results[0].skipped, true);
  assert.equal(second.results[0].backoffUntil, "2026-07-01T12:00:06.000Z");
});

test("status worker retries after a backoff window expires", async () => {
  const activePrinters = [printer({ id: "printer-1", name: "Alpha" })];
  const { supabase, upserts } = createMockSupabase(activePrinters);
  const backoffState = new Map<string, number>([
    ["printer-1", Date.parse("2026-07-01T12:00:01.000Z")],
  ]);
  const connector = {
    async readStatus(input: Printer) {
      return statusFor(input.id, "2026-07-01T12:00:02.000Z");
    },
  };

  const result = await writeStatusWorkerTick({
    supabase,
    connector,
    now: new Date("2026-07-01T12:00:02.000Z"),
    backoffState,
  });

  assert.equal(result.upsertCount, 1);
  assert.equal(upserts.length, 1);
  assert.equal(backoffState.has("printer-1"), false);
});

test("status worker interval reads env with default and minimum clamp", () => {
  const original = process.env.STATUS_POLL_INTERVAL_MS;
  try {
    delete process.env.STATUS_POLL_INTERVAL_MS;
    assert.equal(readStatusWorkerIntervalMs(), 2_000);

    process.env.STATUS_POLL_INTERVAL_MS = "10";
    assert.equal(readStatusWorkerIntervalMs(), 250);

    process.env.STATUS_POLL_INTERVAL_MS = "3000";
    assert.equal(readStatusWorkerIntervalMs(), 3_000);
  } finally {
    if (original === undefined) {
      delete process.env.STATUS_POLL_INTERVAL_MS;
    } else {
      process.env.STATUS_POLL_INTERVAL_MS = original;
    }
  }
});
