import http from "node:http";
import process from "node:process";

const port = Number(process.env.MOCK_MOONRAKER_PORT ?? 7125);
let scenario = process.env.MOCK_MOONRAKER_SCENARIO ?? "ready";
let uploadedFile = "fixture.gcode";
let progress = 0;

const scenarios = new Set([
  "ready",
  "printing",
  "paused",
  "busy",
  "offline",
  "timeout",
  "shutdown",
  "malformed",
  "command-failure",
]);

function headers(contentType = "application/json") {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Content-Type": contentType,
  };
}

function send(res, status, value) {
  res.writeHead(status, headers());
  res.end(JSON.stringify(value));
}

function statusPayload() {
  const printState =
    scenario === "paused"
      ? "paused"
      : scenario === "printing" || scenario === "busy"
        ? "printing"
        : scenario === "shutdown"
          ? "error"
          : "standby";

  if (printState === "printing") progress = Math.min(progress + 0.035, 0.96);
  const layer =
    printState === "standby" ? null : Math.max(1, Math.round(progress * 80));
  return {
    result: {
      eventtime: Date.now() / 1000,
      status: {
        webhooks: {
          state: scenario === "shutdown" ? "shutdown" : "ready",
          state_message:
            scenario === "shutdown" ? "Mock MCU shutdown" : "Printer is ready",
        },
        print_stats: {
          state: printState,
          filename: printState === "standby" ? "" : uploadedFile,
          message: scenario === "shutdown" ? "Mock MCU shutdown" : "",
          info: { current_layer: layer, total_layer: 80 },
        },
        virtual_sdcard: { progress: printState === "standby" ? 0 : progress },
        extruder: {
          temperature:
            printState === "standby"
              ? 24.5
              : 208 + Math.sin(Date.now() / 1500) * 2,
          target: printState === "standby" ? 0 : 210,
        },
        heater_bed: {
          temperature:
            printState === "standby" ? 23.8 : 59 + Math.sin(Date.now() / 2200),
          target: printState === "standby" ? 0 : 60,
        },
      },
    },
  };
}

function collect(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(
    req.url ?? "/",
    `http://${req.headers.host ?? "localhost"}`,
  );

  if (req.method === "OPTIONS") {
    res.writeHead(204, headers());
    res.end();
    return;
  }

  if (url.pathname === "/__mock/health") {
    send(res, 200, { ok: true, scenario });
    return;
  }

  if (url.pathname === "/__mock/scenario" && req.method === "POST") {
    const body = JSON.parse((await collect(req)).toString() || "{}");
    if (!scenarios.has(body.scenario)) {
      send(res, 400, { error: `Unknown scenario: ${body.scenario}` });
      return;
    }
    scenario = body.scenario;
    if (scenario === "printing") progress = Math.max(progress, 0.12);
    if (scenario === "ready") progress = 0;
    send(res, 200, { ok: true, scenario });
    return;
  }

  if (scenario === "timeout") {
    setTimeout(() => send(res, 504, { error: "Mock timeout" }), 10_000);
    return;
  }

  if (scenario === "offline") {
    send(res, 503, { error: "Mock printer offline" });
    return;
  }

  if (scenario === "malformed") {
    res.writeHead(200, headers("application/json"));
    res.end("{this-is-not-json");
    return;
  }

  if (scenario === "command-failure" && req.method === "POST") {
    send(res, 500, { error: { code: 500, message: "Mock command failure" } });
    return;
  }

  if (
    url.pathname === "/printer/objects/query" ||
    url.pathname === "/printer/info"
  ) {
    send(
      res,
      200,
      url.pathname.endsWith("/info")
        ? {
            result: {
              state: scenario === "shutdown" ? "shutdown" : "ready",
              state_message: "Mock printer",
            },
          }
        : statusPayload(),
    );
    return;
  }

  if (url.pathname === "/server/webcams/list") {
    send(res, 200, { result: { webcams: [] } });
    return;
  }

  if (url.pathname === "/server/files/upload" && req.method === "POST") {
    const body = await collect(req);
    const match = body.toString("latin1").match(/filename="([^"]+)"/);
    uploadedFile = match?.[1] ?? uploadedFile;
    send(res, 201, { item: { path: uploadedFile, root: "gcodes" } });
    return;
  }

  const commandStates = new Map([
    ["/printer/print/start", "printing"],
    ["/printer/print/pause", "paused"],
    ["/printer/print/resume", "printing"],
    ["/printer/print/cancel", "ready"],
    ["/printer/emergency_stop", "shutdown"],
    ["/printer/restart", "ready"],
    ["/printer/firmware_restart", "ready"],
  ]);

  if (req.method === "POST" && commandStates.has(url.pathname)) {
    await collect(req);
    scenario = commandStates.get(url.pathname);
    if (url.pathname === "/printer/print/start") progress = 0.05;
    send(res, 200, { result: "ok" });
    return;
  }

  if (url.pathname === "/printer/gcode/script" && req.method === "POST") {
    await collect(req);
    send(res, 200, { result: "ok" });
    return;
  }

  send(res, 404, { error: `No mock route for ${req.method} ${url.pathname}` });
});

server.listen(port, "127.0.0.1", () => {
  console.log(
    `Mock Moonraker listening on http://127.0.0.1:${port} (${scenario})`,
  );
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
