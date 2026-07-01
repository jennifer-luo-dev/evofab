// @vitest-environment node

import { spawn, type ChildProcess } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const port = 7137;
const baseUrl = `http://127.0.0.1:${port}`;
let child: ChildProcess;

async function waitForServer() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/__mock/health`);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Mock Moonraker did not start");
}

describe("mock Moonraker process", () => {
  beforeAll(async () => {
    child = spawn(process.execPath, ["scripts/mock-moonraker.mjs"], {
      env: { ...process.env, MOCK_MOONRAKER_PORT: String(port) },
      stdio: "ignore",
    });
    await waitForServer();
  });

  afterAll(() => child.kill("SIGTERM"));

  it("switches deterministic printer scenarios", async () => {
    const update = await fetch(`${baseUrl}/__mock/scenario`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scenario: "shutdown" }),
    });
    expect(update.ok).toBe(true);

    const status = await fetch(`${baseUrl}/printer/objects/query`).then(
      (response) => response.json(),
    );
    expect(status.result.status.webhooks.state).toBe("shutdown");
    expect(status.result.status.print_stats.state).toBe("error");
  });

  it("represents offline and command-failure states", async () => {
    await fetch(`${baseUrl}/__mock/scenario`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scenario: "offline" }),
    });
    expect((await fetch(`${baseUrl}/printer/info`)).status).toBe(503);

    await fetch(`${baseUrl}/__mock/scenario`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scenario: "command-failure" }),
    });
    expect(
      (await fetch(`${baseUrl}/printer/print/start`, { method: "POST" }))
        .status,
    ).toBe(500);
  });
});
