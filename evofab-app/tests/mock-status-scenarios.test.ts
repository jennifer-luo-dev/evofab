import assert from "node:assert/strict";
import test from "node:test";
import { buildMockPrinterStatus } from "../app/lib/mock-status-scenarios";
import type { Printer } from "../app/types/printer";

const printer: Printer = {
  id: "00000000-0000-0000-0000-000000000001",
  name: "EvoFab Alpha",
  model: "Mock FDM",
  ip: "127.0.0.1",
  port: 7125,
  type: "FDM",
  material: "PLA Standard",
  build_volume: "220x220x250mm",
  is_active: true,
  created_at: "2026-07-01T00:00:00.000Z",
};

test("mock status scenarios are deterministic for a seed and tick", () => {
  const now = new Date("2026-07-01T12:00:00.000Z");
  const first = buildMockPrinterStatus({
    printer,
    seed: "stable",
    tick: 3,
    now,
  });
  const second = buildMockPrinterStatus({
    printer,
    seed: "stable",
    tick: 3,
    now,
  });

  assert.deepEqual(first, second);
  assert.equal(first.status.printer_id, printer.id);
  assert.equal(first.status.updated_at, now.toISOString());
});

test("mock status scenarios include offline synthesis in the cycle", () => {
  const now = new Date("2026-07-01T12:00:00.000Z");
  const statuses = Array.from({ length: 12 }, (_, tick) =>
    buildMockPrinterStatus({ printer, seed: "offline-cycle", tick, now }),
  );

  assert.ok(statuses.some((scenario) => scenario.kind === "offline"));
  assert.ok(statuses.some((scenario) => scenario.status.status === "printing"));
  assert.ok(
    statuses.every(
      (scenario) => scenario.status.updated_at === now.toISOString(),
    ),
  );
});
