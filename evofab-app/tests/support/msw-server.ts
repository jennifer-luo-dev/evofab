import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

export const MOCK_MOONRAKER_URL = "http://127.0.0.1:7125";

export const server = setupServer(
  http.get(`${MOCK_MOONRAKER_URL}/printer/objects/query`, () =>
    HttpResponse.json({
      result: {
        status: {
          webhooks: { state: "ready", state_message: "Printer is ready" },
          print_stats: { state: "standby", filename: "", info: {} },
          virtual_sdcard: { progress: 0 },
          extruder: { temperature: 25, target: 0 },
          heater_bed: { temperature: 24, target: 0 },
        },
      },
    }),
  ),
  http.post(`${MOCK_MOONRAKER_URL}/server/files/upload`, () =>
    HttpResponse.json({ item: { path: "fixture.gcode" } }, { status: 201 }),
  ),
  http.post(`${MOCK_MOONRAKER_URL}/printer/gcode/script`, () =>
    HttpResponse.json({ result: "ok" }),
  ),
  http.post(`${MOCK_MOONRAKER_URL}/printer/print/start`, () =>
    HttpResponse.json({ result: "ok" }),
  ),
  http.post(`${MOCK_MOONRAKER_URL}/printer/print/pause`, () =>
    HttpResponse.json({ result: "ok" }),
  ),
  http.post(`${MOCK_MOONRAKER_URL}/printer/print/resume`, () =>
    HttpResponse.json({ result: "ok" }),
  ),
  http.post(`${MOCK_MOONRAKER_URL}/printer/print/cancel`, () =>
    HttpResponse.json({ result: "ok" }),
  ),
  http.post(`${MOCK_MOONRAKER_URL}/printer/emergency_stop`, () =>
    HttpResponse.json({ result: "ok" }),
  ),
  http.post(`${MOCK_MOONRAKER_URL}/printer/restart`, () =>
    HttpResponse.json({ result: "ok" }),
  ),
  http.post(`${MOCK_MOONRAKER_URL}/printer/firmware_restart`, () =>
    HttpResponse.json({ result: "ok" }),
  ),
);
