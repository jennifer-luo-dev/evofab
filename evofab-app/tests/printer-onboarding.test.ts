import assert from "node:assert/strict";
import test from "node:test";
import {
  initialPrinterStatus,
  normalizePrinterConnectionTestInput,
  normalizePrinterOnboardingInput,
  PrinterOnboardingError,
} from "../app/lib/printer-onboarding";

test("printer onboarding normalizes existing registry columns", () => {
  const input = normalizePrinterOnboardingInput({
    name: " EvoFab Delta ",
    model: " Custom FGF ",
    ip: "127.0.0.4",
    type: "FGF",
    material: " PLA pellets ",
    build_volume: "300x300x400mm",
  });

  assert.deepEqual(input, {
    name: "EvoFab Delta",
    model: "Custom FGF",
    ip: "127.0.0.4",
    port: 7125,
    type: "FGF",
    material: "PLA pellets",
    build_volume: "300x300x400mm",
    webcam_url: null,
    is_active: true,
  });
});

test("printer onboarding keeps optional webcam URL", () => {
  const input = normalizePrinterOnboardingInput({
    name: "EvoFab Camera",
    model: "Mock FDM",
    ip: "127.0.0.5",
    type: "FDM",
    webcam_url: " http://127.0.0.1:8080/?action=stream ",
  });

  assert.equal(input.webcam_url, "http://127.0.0.1:8080/?action=stream");
});

test("printer onboarding rejects invalid port and type", () => {
  assert.throws(
    () =>
      normalizePrinterOnboardingInput({
        name: "Bad",
        model: "Bad",
        ip: "127.0.0.1",
        port: 70000,
        type: "FDM",
      }),
    (error) =>
      error instanceof PrinterOnboardingError &&
      error.code === "PRINTER_INVALID_PORT",
  );

  assert.throws(
    () =>
      normalizePrinterOnboardingInput({
        name: "Bad",
        model: "Bad",
        ip: "127.0.0.1",
        type: "SLA",
      }),
    (error) =>
      error instanceof PrinterOnboardingError &&
      error.code === "PRINTER_INVALID_TYPE",
  );
});

test("printer onboarding creates an offline initial status row", () => {
  const status = initialPrinterStatus("printer-1");

  assert.equal(status.printer_id, "printer-1");
  assert.equal(status.online, false);
  assert.equal(status.status, "offline");
  assert.equal(status.progress_source, "unknown");
  assert.equal(status.layer_source, "unknown");
});

test("printer connection test reuses onboarding normalization", () => {
  const printer = normalizePrinterConnectionTestInput({
    name: " EvoFab H ",
    model: " Custom FGF ",
    ip: " 10.247.137.21 ",
    port: "7125",
    type: "FGF",
  });

  assert.equal(printer.id, "connection-test");
  assert.equal(printer.name, "EvoFab H");
  assert.equal(printer.model, "Custom FGF");
  assert.equal(printer.ip, "10.247.137.21");
  assert.equal(printer.port, 7125);
  assert.equal(printer.type, "FGF");
  assert.equal(printer.webcam_url, null);
  assert.equal(printer.is_active, true);
});
