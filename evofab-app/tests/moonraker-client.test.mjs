import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");
const tempDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "evofab-moonraker-tests-"),
);

function compileModule(sourceName) {
  const sourcePath = path.join(appRoot, "app", "lib", sourceName);
  const outputName = sourceName.replace(/\.ts$/, ".mjs");
  const outputPath = path.join(tempDir, outputName);
  const source = fs.readFileSync(sourcePath, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: true,
    },
  }).outputText;

  fs.writeFileSync(
    outputPath,
    compiled
      .replaceAll("./moonraker-config", "./moonraker-config.mjs")
      .replaceAll("./moonraker-errors", "./moonraker-errors.mjs"),
  );
}

compileModule("moonraker-errors.ts");
compileModule("moonraker-config.ts");
compileModule("moonraker-client.ts");

const { HARDWARE_CONFIRMATION, getMoonrakerMode, resolveMoonrakerBaseUrl } =
  await import(pathToFileURL(path.join(tempDir, "moonraker-config.mjs")));
const {
  MoonrakerStatusConnector,
  normalizeMoonrakerServerInfo,
  normalizeMoonrakerStatus,
} = await import(pathToFileURL(path.join(tempDir, "moonraker-client.mjs")));
const { MoonrakerError } = await import(
  pathToFileURL(path.join(tempDir, "moonraker-errors.mjs"))
);

const printer = {
  id: "printer-1",
  name: "FGF-01",
  model: "Mock",
  ip: "10.0.0.12",
  port: 7125,
  type: "FDM",
  material: null,
  build_volume: null,
  is_active: true,
  created_at: "2026-07-01T00:00:00.000Z",
};

test("mode resolution defaults to mock and accepts only explicit modes", () => {
  assert.equal(getMoonrakerMode({}), "mock");
  assert.equal(getMoonrakerMode({ MOONRAKER_MODE: "local" }), "local");
  assert.equal(getMoonrakerMode({ MOONRAKER_MODE: "hardware" }), "hardware");
  assert.equal(getMoonrakerMode({ MOONRAKER_MODE: "surprise" }), "mock");
});

test("mock mode rejects non-loopback mock URLs", () => {
  assert.throws(
    () =>
      resolveMoonrakerBaseUrl({
        printerId: "printer-1",
        mockBaseUrl: "http://10.0.0.12:7125",
        env: { MOONRAKER_MODE: "mock" },
      }),
    (error) =>
      error instanceof MoonrakerError && error.code === "UNSAFE_MOCK_URL",
  );
});

test("local mode disables Moonraker calls", () => {
  assert.throws(
    () =>
      resolveMoonrakerBaseUrl({
        printerId: "printer-1",
        ip: "10.0.0.12",
        port: 7125,
        env: { MOONRAKER_MODE: "local" },
      }),
    (error) =>
      error instanceof MoonrakerError && error.code === "MOONRAKER_DISABLED",
  );
});

test("hardware mode requires explicit confirmation", () => {
  assert.throws(
    () =>
      resolveMoonrakerBaseUrl({
        printerId: "printer-1",
        ip: "10.0.0.12",
        port: 7125,
        env: { MOONRAKER_MODE: "hardware" },
      }),
    (error) =>
      error instanceof MoonrakerError &&
      error.code === "HARDWARE_CONFIRMATION_REQUIRED",
  );

  assert.equal(
    resolveMoonrakerBaseUrl({
      printerId: "printer-1",
      ip: "10.0.0.12",
      port: 7125,
      env: {
        MOONRAKER_MODE: "hardware",
        HARDWARE_CONFIRMATION,
      },
    }),
    "http://10.0.0.12:7125",
  );
});

test("normalizes Moonraker object query responses into printer_status rows", () => {
  const status = normalizeMoonrakerStatus(
    "printer-1",
    {
      result: {
        status: {
          webhooks: { state: "ready" },
          print_stats: {
            state: "printing",
            filename: "part.gcode",
            info: { current_layer: 12, total_layer: 80 },
          },
          virtual_sdcard: { progress: 0.375 },
          extruder: { temperature: 209.5, target: 210 },
          heater_bed: { temperature: 59.2, target: 60 },
        },
      },
    },
    new Date("2026-07-01T00:00:00.000Z"),
  );

  assert.deepEqual(status, {
    printer_id: "printer-1",
    online: true,
    status: "printing",
    print_state: "printing",
    filename: "part.gcode",
    progress: 37.5,
    layer_current: 12,
    layer_total: 80,
    hotend_temp: 209.5,
    hotend_target: 210,
    bed_temp: 59.2,
    bed_target: 60,
    eta_seconds: null,
    progress_source: "estimated",
    layer_source: "exact",
    fault_message: null,
    fault_mcu: null,
    updated_at: "2026-07-01T00:00:00.000Z",
  });
});

test("normalizes null print_stats.info with estimated layer and ETA", () => {
  const status = normalizeMoonrakerStatus(
    "printer-1",
    {
      result: {
        status: {
          webhooks: { state: "ready" },
          print_stats: {
            state: "printing",
            filename: "fallback.gcode",
            print_duration: 30,
            info: { current_layer: null, total_layer: null },
          },
          virtual_sdcard: { progress: 0.5 },
        },
      },
    },
    new Date("2026-07-01T00:00:00.000Z")
  );

  assert.equal(status.progress, 50);
  assert.equal(status.layer_current, 50);
  assert.equal(status.layer_total, 100);
  assert.equal(status.layer_source, "estimated");
  assert.equal(status.eta_seconds, 30);
});

test("normalizes Klipper shutdown fault text and MCU", () => {
  const status = normalizeMoonrakerStatus(
    "printer-1",
    {
      result: {
        status: {
          webhooks: {
            state: "shutdown",
            state_message: "MCU 'toolhead' shutdown: ADC out of range",
          },
          print_stats: {
            state: "error",
            message: "MCU 'toolhead' shutdown: ADC out of range",
          },
          virtual_sdcard: { progress: 0.25 },
        },
      },
    },
    new Date("2026-07-01T00:00:00.000Z")
  );

  assert.equal(status.status, "error");
  assert.equal(status.fault_message, "MCU 'toolhead' shutdown: ADC out of range");
  assert.equal(status.fault_mcu, "toolhead");
});

test("connector reads status only through a safe mock loopback URL", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async (url) => {
    assert.equal(
      String(url),
      "http://127.0.0.1:7125/printer/objects/query?webhooks&print_stats&extruder&heater_bed&virtual_sdcard",
    );
    return new Response(
      JSON.stringify({
        result: {
          status: {
            webhooks: { state: "ready" },
            print_stats: { state: "standby" },
            virtual_sdcard: { progress: 0 },
          },
        },
      }),
      { status: 200 },
    );
  };

  const connector = new MoonrakerStatusConnector({
    mockBaseUrl: "http://127.0.0.1:7125",
  });
  const status = await connector.readStatus(printer);

  assert.equal(status.status, "idle");
  assert.equal(status.online, true);
});

test("connector reports malformed and offline responses predictably", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async () => new Response("{not-json", { status: 200 });
  await assert.rejects(
    () => new MoonrakerStatusConnector().readStatus(printer),
    (error) =>
      error instanceof MoonrakerError &&
      error.code === "MOONRAKER_MALFORMED_RESPONSE",
  );

  globalThis.fetch = async () => new Response("offline", { status: 503 });
  await assert.rejects(
    () => new MoonrakerStatusConnector().readStatus(printer),
    (error) =>
      error instanceof MoonrakerError && error.code === "MOONRAKER_OFFLINE",
  );
});

test("normalizes Moonraker server info with optional Klipper version", () => {
  assert.deepEqual(
    normalizeMoonrakerServerInfo("printer-1", {
      result: {
        moonraker_version: "v0.9.3",
        klipper_version: "v0.12.0",
        klippy_state: "ready",
      },
    }),
    {
      moonrakerVersion: "v0.9.3",
      klipperVersion: "v0.12.0",
      klippyState: "ready",
    },
  );

  assert.deepEqual(
    normalizeMoonrakerServerInfo("printer-1", {
      result: {
        moonraker_version: "v0.9.3",
      },
    }),
    {
      moonrakerVersion: "v0.9.3",
      klipperVersion: null,
      klippyState: null,
    },
  );
});

test("connector reads server info through the same safe base URL", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async (url) => {
    assert.equal(String(url), "http://127.0.0.1:7125/server/info");
    return new Response(
      JSON.stringify({
        result: {
          moonraker_version: "v0.9.3",
          klippy_state: "ready",
        },
      }),
      { status: 200 },
    );
  };

  const connector = new MoonrakerStatusConnector({
    mockBaseUrl: "http://127.0.0.1:7125",
  });
  const info = await connector.readServerInfo(printer);

  assert.equal(info.moonrakerVersion, "v0.9.3");
  assert.equal(info.klipperVersion, null);
  assert.equal(info.klippyState, "ready");
});

test("connector reports malformed server info predictably", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async () => new Response("{not-json", { status: 200 });
  await assert.rejects(
    () => new MoonrakerStatusConnector().readServerInfo(printer),
    (error) =>
      error instanceof MoonrakerError &&
      error.code === "MOONRAKER_MALFORMED_RESPONSE",
  );
});
