import assert from "node:assert/strict";
import test from "node:test";
import { config } from "dotenv";
import {
  createScriptSupabaseClient,
  writeMockStatusTick,
} from "../../app/lib/mock-status-producer";

config({ path: ".env.local" });

test("local Supabase mock producer writes fresh statuses", async (t) => {
  if (process.env.RUN_LOCAL_SUPABASE_TESTS !== "1") {
    t.skip(
      "Set RUN_LOCAL_SUPABASE_TESTS=1 with local Supabase running to execute.",
    );
    return;
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    t.skip("Set SUPABASE_SERVICE_ROLE_KEY to execute local Supabase writes.");
    return;
  }

  process.env.MOONRAKER_MODE = "mock";
  const supabase = createScriptSupabaseClient();
  const now = new Date();
  const result = await writeMockStatusTick({
    supabase,
    seed: "local-integration",
    tick: 1,
    now,
  });

  assert.ok(result.printerCount >= 1);

  const { data, error } = await supabase
    .from("printer_status")
    .select("printer_id, updated_at")
    .in(
      "printer_id",
      result.statuses.map((status) => status.printer_id),
    );

  assert.ifError(error);
  assert.equal(data?.length, result.printerCount);
});
