import assert from "node:assert/strict";
import test from "node:test";
import { writeMockStatusTick } from "../app/lib/mock-status-producer";
import type { Printer, PrinterStatus } from "../app/types/printer";

function createMockSupabase() {
  const activePrinters: Printer[] = [
    {
      id: "00000000-0000-0000-0000-000000000001",
      name: "EvoFab Alpha",
      model: "Mock FDM",
      ip: "127.0.0.1",
      port: 7125,
      type: "FDM",
      material: "PLA Standard",
      build_volume: "220x220x250mm",
      webcam_url: null,
      is_active: true,
      created_at: "2026-07-01T00:00:00.000Z",
    },
    {
      id: "00000000-0000-0000-0000-000000000002",
      name: "EvoFab Beta",
      model: "Mock FGF",
      ip: "127.0.0.2",
      port: 7125,
      type: "FGF",
      material: "Shore 40A TPE",
      build_volume: "300x300x400mm",
      webcam_url: null,
      is_active: true,
      created_at: "2026-07-01T00:00:00.000Z",
    },
  ];
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
                    async single() {
                      return { data: activePrinters[0], error: null };
                    },
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

        if (table === "jobs") {
          return {
            select() {
              return {
                eq() {
                  return {
                    eq() {
                      return {
                        order() {
                          return {
                            async limit() {
                              return { data: [], error: null };
                            },
                          };
                        },
                      };
                    },
                    in() {
                      return {
                        async limit() {
                          return { data: [], error: null };
                        },
                      };
                    },
                  };
                },
              };
            },
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      },
    },
  };
}

test("producer writes one status row per active printer", async () => {
  process.env.MOONRAKER_MODE = "mock";
  const { supabase, upserts } = createMockSupabase();
  const now = new Date("2026-07-01T12:00:00.000Z");

  const result = await writeMockStatusTick({
    supabase,
    seed: "producer-test",
    tick: 4,
    now,
  });

  assert.equal(result.printerCount, 2);
  assert.equal(upserts.length, 1);
  assert.equal(upserts[0].length, 2);
  assert.ok(upserts[0].every((row) => row.updated_at === now.toISOString()));
});

test("producer refuses to run outside mock mode", async () => {
  process.env.MOONRAKER_MODE = "local";
  const { supabase } = createMockSupabase();

  await assert.rejects(
    () => writeMockStatusTick({ supabase, tick: 0 }),
    /Mock status producer only runs/,
  );
});
