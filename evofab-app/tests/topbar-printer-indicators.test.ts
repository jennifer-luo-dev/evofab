import assert from "node:assert/strict";
import test from "node:test";
import { buildPrinterIndicators } from "../app/lib/topbar-printer-indicators";

test("topbar printer indicators are sourced from active printers and printer_status", () => {
  const indicators = buildPrinterIndicators(
    [
      {
        id: "printer-fdm",
        name: "EvoFab Sovol Zero",
        model: "SOVOL ZERO",
        type: "FDM",
      },
      {
        id: "printer-fgf",
        name: "FGF Printer",
        model: "FGF Printer",
        type: "FGF",
      },
      {
        id: "printer-extra",
        name: "Aux Printer",
        model: "Mock",
        type: "FDM",
      },
    ],
    [
      { printer_id: "printer-fdm", status: "idle" },
      { printer_id: "printer-fgf", status: "printing" },
    ],
  );

  assert.deepEqual(indicators, [
    { label: "FDM Printer", printerId: "printer-fdm", status: "idle" },
    { label: "FGF Printer", printerId: "printer-fgf", status: "printing" },
    { label: "Aux Printer", printerId: "printer-extra", status: "offline" },
  ]);
});

test("topbar preserves the demo-day Printer H display rename", () => {
  const indicators = buildPrinterIndicators(
    [
      {
        id: "printer-h",
        name: "Printer H",
        model: "Legacy lab label",
        type: "FGF",
      },
    ],
    [{ printer_id: "printer-h", status: "paused" }],
  );

  assert.equal(indicators[0].label, "FGF Printer");
  assert.equal(indicators[0].status, "paused");
});
