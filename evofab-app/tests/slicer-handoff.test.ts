import assert from "node:assert/strict";
import test from "node:test";
import { handoffSlicerJob } from "../app/lib/slicer-handoff";
import type { Printer } from "../app/types/printer";

const printer: Printer = {
  id: "printer-fdm",
  name: "FDM Printer",
  model: "Sovol Zero",
  ip: "10.247.137.89",
  port: 7125,
  type: "FDM",
  material: "PLA",
  build_volume: null,
  webcam_url: null,
  is_active: true,
  created_at: "2026-07-13T00:00:00.000Z",
  driver_type: "moonraker",
};

function fixture() {
  const events: string[] = [];
  const updates: Record<string, unknown>[] = [];
  const supabase = {
    from(table: "printers" | "jobs") {
      return {
        select() {
          return {
            eq() {
              return {
                async single() {
                  events.push(`select:${table}`);
                  return {
                    data: table === "printers" ? printer : null,
                    error: null,
                  };
                },
              };
            },
          };
        },
        insert(values: Record<string, unknown>) {
          return {
            select() {
              return {
                async single() {
                  events.push("insert:jobs");
                  return { data: { id: "job-1", ...values }, error: null };
                },
              };
            },
          };
        },
        update(values: Record<string, unknown>) {
          return {
            async eq() {
              updates.push(values);
              events.push("update:jobs");
              return { data: { id: "job-1", ...values }, error: null };
            },
          };
        },
      };
    },
  };
  return { events, updates, supabase };
}

test("handoff creates a job before upload, verifies it, and never starts", async () => {
  const { events, supabase } = fixture();
  const calls: string[] = [];
  const result = await handoffSlicerJob("slice-1", printer.id, {
    supabase: supabase as never,
    slicer: {
      async getJob() {
        return {
          job_id: "slice-1",
          status: "done",
          result: {
            engine: "OrcaSlicer 3.0.1",
            gcode_url: "",
            print_time_s: 1,
            material_used_mm3: 1,
            material_used_g: 1,
            profile_id: "pla-fdm",
          },
        };
      },
      async fetchGcode() {
        calls.push("fetch");
        return "G1 X1";
      },
    },
    createDriver: () => ({
      capabilities: new Set([
        "upload_file",
        "verify_file",
        "start_print",
      ] as const),
      async readStatus() {
        throw new Error("unused");
      },
      async uploadFile(_printer, file) {
        calls.push(`upload:${file.name}`);
        return {
          outcome: "succeeded",
          status: 201,
          retryable: false,
          path: file.name,
        };
      },
      async verifyStoredFile(_printer, path) {
        calls.push(`verify:${path}`);
        return { outcome: "succeeded", status: 200, retryable: false };
      },
    }),
  });
  assert.equal(result.ok, true);
  assert.deepEqual(events.slice(0, 2), ["select:printers", "insert:jobs"]);
  assert.deepEqual(calls, [
    "fetch",
    "upload:slice-slice-1.gcode",
    "verify:slice-slice-1.gcode",
  ]);
  assert.equal(
    calls.some((call) => call.startsWith("start")),
    false,
  );
});

test("handoff stores timeout as outcome_unknown without retry", async () => {
  const { updates, supabase } = fixture();
  let uploads = 0;
  const result = await handoffSlicerJob("slice-2", printer.id, {
    supabase: supabase as never,
    slicer: {
      async getJob() {
        return {
          job_id: "slice-2",
          status: "done",
          result: {
            engine: "OrcaSlicer 3.0.1",
            gcode_url: "",
            print_time_s: 1,
            material_used_mm3: 1,
            material_used_g: 1,
            profile_id: "pla-fdm",
          },
        };
      },
      async fetchGcode() {
        return "G1 X1";
      },
    },
    createDriver: () => ({
      capabilities: new Set(["upload_file", "verify_file"] as const),
      async readStatus() {
        throw new Error("unused");
      },
      async uploadFile() {
        uploads += 1;
        return {
          outcome: "outcome_unknown",
          status: null,
          retryable: false,
          code: "MOONRAKER_TIMEOUT",
        };
      },
      async verifyStoredFile() {
        throw new Error("must not verify");
      },
    }),
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 504);
  assert.equal(uploads, 1);
  assert.equal(updates[0].command_outcome, "outcome_unknown");
});
