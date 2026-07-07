#!/usr/bin/env node
// File purpose: Runs the local Moonraker printer_status poller.

import "dotenv/config";
import { createScriptSupabaseClient } from "@/app/lib/mock-status-producer";
import {
  createStatusWorkerBackoffState,
  createStatusWorkerConnector,
  readStatusWorkerIntervalMs,
  writeStatusWorkerTick,
} from "@/app/lib/status-worker";

const supabase = createScriptSupabaseClient();
const connector = createStatusWorkerConnector();
const intervalMs = readStatusWorkerIntervalMs();
const backoffState = createStatusWorkerBackoffState();
let tick = 0;
let stopped = false;

function logTick(result: Awaited<ReturnType<typeof writeStatusWorkerTick>>) {
  console.log(
    JSON.stringify({
      event: "status-worker.tick",
      tick: result.tick,
      printers: result.printerCount,
      upserts: result.upsertCount,
      intervalMs,
      results: result.results,
    }),
  );
}

async function runTick(): Promise<void> {
  const result = await writeStatusWorkerTick({
    supabase,
    connector,
    tick,
    now: new Date(),
    intervalMs,
    backoffState,
  });
  logTick(result);
  tick += 1;
}

async function loop(): Promise<void> {
  while (!stopped) {
    const startedAt = Date.now();
    try {
      await runTick();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown status worker error.";
      console.error(
        JSON.stringify({
          event: "status-worker.error",
          tick,
          message,
        }),
      );
      process.exitCode = 1;
    }

    const elapsed = Date.now() - startedAt;
    const waitMs = Math.max(0, intervalMs - elapsed);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
}

function stop() {
  stopped = true;
  console.log(JSON.stringify({ event: "status-worker.stop", tick }));
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);

void loop();
