#!/usr/bin/env node
// File purpose: Runs the local deterministic mock printer_status producer.

import "dotenv/config";
import {
  DEFAULT_MOCK_STATUS_SEED,
  createScriptSupabaseClient,
  readMockProducerIntervalMs,
  writeMockStatusTick,
} from "@/app/lib/mock-status-producer";

const supabase = createScriptSupabaseClient();
const intervalMs = readMockProducerIntervalMs();
const seed = process.env.MOCK_STATUS_SEED ?? DEFAULT_MOCK_STATUS_SEED;
let tick = 0;
let stopped = false;

async function runTick(): Promise<void> {
  const result = await writeMockStatusTick({
    supabase,
    seed,
    tick,
    now: new Date(),
  });
  console.log(
    `[mock-status] tick=${result.tick} printers=${result.printerCount} intervalMs=${intervalMs}`,
  );
  tick += 1;
}

async function loop(): Promise<void> {
  while (!stopped) {
    const startedAt = Date.now();
    try {
      await runTick();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unknown mock status producer error.";
      console.error(`[mock-status] ${message}`);
      process.exitCode = 1;
    }

    const elapsed = Date.now() - startedAt;
    const waitMs = Math.max(0, intervalMs - elapsed);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
}

process.on("SIGINT", () => {
  stopped = true;
});
process.on("SIGTERM", () => {
  stopped = true;
});

void loop();
