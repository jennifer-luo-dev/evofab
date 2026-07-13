import assert from "node:assert/strict";
import test from "node:test";
import { offlinePrinterStatus } from "../app/lib/printer-driver";
import { createPrinterDriver } from "../app/lib/status-worker";
import { PrusaLinkDriver } from "../app/lib/prusalink-driver";
import { MoonrakerStatusConnector } from "../app/lib/moonraker-client";
import { toClientSafePrinter } from "../app/lib/printer-status-source";
import type { Printer } from "../app/types/printer";

const printer = (driver_type: Printer["driver_type"]): Printer => ({
  id: "printer-1",
  name: "Fixture",
  model: "Fixture",
  ip: "192.168.1.100",
  port: 80,
  type: "FDM",
  material: null,
  build_volume: null,
  webcam_url: null,
  is_active: true,
  created_at: "2026-07-10T00:00:00.000Z",
  driver_type,
});

test("driver registry selects the configured implementation", () => {
  assert.ok(
    createPrinterDriver(printer("prusalink")) instanceof PrusaLinkDriver,
  );
  assert.ok(
    createPrinterDriver(printer("moonraker")) instanceof
      MoonrakerStatusConnector,
  );
});

test("offline telemetry contains only a sanitized category", () => {
  const row = offlinePrinterStatus(
    "printer-1",
    "PRUSALINK_TIMEOUT",
    new Date(0),
  );
  assert.equal(row.status, "offline");
  assert.equal(row.online, false);
  assert.equal(row.fault_message, "PRUSALINK_TIMEOUT");
});

test("client-safe printer projection excludes connection configuration", () => {
  const source = {
    ...printer("prusalink"),
    prusalink_host: "192.168.1.100",
    prusalink_key_file: ".secrets/test.key",
  };
  const output = toClientSafePrinter(
    source,
    offlinePrinterStatus(source.id, "PRUSALINK_TIMEOUT"),
  );
  const json = JSON.stringify(output);
  assert.ok(!json.includes("192.168.1.100"));
  assert.ok(!json.includes(".secrets/test.key"));
  assert.ok(!("ip" in output));
});

test("client-safe printer projection carries only display-safe loaded material", () => {
  const output = toClientSafePrinter(
    printer("moonraker"),
    offlinePrinterStatus("printer-1", "PRUSALINK_TIMEOUT"),
    {
      material_name: "PLA Pellets",
      color: "Natural",
      quantity: 1000,
      unit: "g",
    },
  );
  assert.deepEqual(output.loaded_material, {
    material_name: "PLA Pellets",
    color: "Natural",
    quantity: 1000,
    unit: "g",
  });
});
