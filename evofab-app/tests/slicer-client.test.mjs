import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "evofab-slicer-tests-"));

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
      .replaceAll("./slicer-config", "./slicer-config.mjs")
      .replaceAll("./slicer-errors", "./slicer-errors.mjs"),
  );
}

compileModule("slicer-errors.ts");
compileModule("slicer-config.ts");
compileModule("slicer-client.ts");

const { getSlicerMode, resolveSlicerConfig } = await import(
  pathToFileURL(path.join(tempDir, "slicer-config.mjs"))
);
const { SlicerClient, MOCK_GCODE_FIXTURE, injectPrintStatsInfo } = await import(
  pathToFileURL(path.join(tempDir, "slicer-client.mjs"))
);
const { SlicerError } = await import(
  pathToFileURL(path.join(tempDir, "slicer-errors.mjs"))
);

test("mode resolution defaults to mock and accepts only explicit modes", () => {
  assert.equal(getSlicerMode({}), "mock");
  assert.equal(getSlicerMode({ SLICER_MODE: "mock" }), "mock");
  assert.equal(getSlicerMode({ SLICER_MODE: "real" }), "real");
  assert.equal(getSlicerMode({ SLICER_MODE: "surprise" }), "mock");
});

test("real mode requires url and token", () => {
  assert.throws(
    () => resolveSlicerConfig({ SLICER_MODE: "real" }),
    (error) =>
      error instanceof SlicerError && error.code === "SLICER_UNCONFIGURED",
  );
});

test("mock fixture mirrors real slicer output markers", () => {
  assert.match(MOCK_GCODE_FIXTURE, /START_PRINT/);
  assert.match(MOCK_GCODE_FIXTURE, /SET_PRINT_STATS_INFO TOTAL_LAYER=/);
  assert.match(MOCK_GCODE_FIXTURE, /^G1\b(?=[^\n]*\bE[-+]?\d*\.?\d+)/m);
});

test("mock slicer completes STL submit, poll, and G-code fetch", async () => {
  const client = new SlicerClient({
    env: { SLICER_MODE: "mock" },
    sleep: async () => {},
  });

  const submit = await client.submitSlice({
    model: new File(["solid cube\nendsolid cube\n"], "cube.stl", {
      type: "model/stl",
    }),
    profileId: "pla-fgf",
    rotation: [0, 0, 0, 1],
    supports: true,
  });
  const job = await client.pollJob(submit.job_id);
  const gcode = await client.fetchGcode(job.job_id);

  assert.equal(submit.status, "queued");
  assert.equal(job.status, "done");
  assert.ok(job.result);
  assert.deepEqual(job.result.rotation, [0, 0, 0, 1]);
  assert.equal(job.result.supports, true);
  assert.match(gcode, /START_PRINT/);
  assert.match(gcode, /SET_PRINT_STATS_INFO TOTAL_LAYER=/);
  assert.match(gcode, /^G1\b(?=[^\n]*\bE[-+]?\d*\.?\d+)/m);
});

test("injectPrintStatsInfo adds layer metadata after START_PRINT", () => {
  const gcode = injectPrintStatsInfo("START_PRINT\nG1 X1 Y1 E1", 12);

  assert.match(gcode, /START_PRINT\nSET_PRINT_STATS_INFO TOTAL_LAYER=12\nG1/);
  assert.equal(injectPrintStatsInfo(gcode, 99), gcode);
});

test("submitSlice sends bearer auth and multipart model/profile fields", async () => {
  let seenRequest;
  const fetchImpl = async (url, init) => {
    seenRequest = { url, init };
    return new Response(JSON.stringify({ job_id: "job-1", status: "queued" }), {
      status: 202,
    });
  };
  const client = new SlicerClient({
    env: {
      SLICER_MODE: "real",
      SLICER_URL: "http://slicer.test/",
      SLICER_TOKEN: "secret",
    },
    fetchImpl,
  });

  const response = await client.submitSlice({
    model: new File(["solid cube\nendsolid cube\n"], "cube.stl", {
      type: "model/stl",
    }),
    profileId: "pla-fgf",
    rotation: [0, 0, 0, 1],
    supports: true,
  });

  assert.deepEqual(response, { job_id: "job-1", status: "queued" });
  assert.equal(seenRequest.url, "http://slicer.test/slice");
  assert.equal(seenRequest.init.headers.Authorization, "Bearer secret");
  assert.equal(seenRequest.init.body.get("profile_id"), "pla-fgf");
  assert.equal(seenRequest.init.body.get("model").name, "cube.stl");
  assert.equal(seenRequest.init.body.get("rotation"), "[0,0,0,1]");
  assert.equal(seenRequest.init.body.get("supports"), "true");
});

test("inspectModel posts STL and optional rotation in real mode", async () => {
  let seenRequest;
  const fetchImpl = async (url, init) => {
    seenRequest = { url, init };
    return new Response(
      JSON.stringify({
        bounding_box_mm: { x: 10, y: 20, z: 30 },
        is_watertight: true,
        overhang_ratio: 0.2,
        triangle_count: 12,
        faces: [
          {
            id: "face-0",
            rank: 1,
            normal: [0, 0, -1],
            area_mm2: 400,
            centroid_mm: [10, 10, 0],
            triangle_indices: [0, 1],
            quaternion_xyzw: [0, 0, 0, 1],
          },
        ],
      }),
      { status: 200 },
    );
  };
  const client = new SlicerClient({
    env: {
      SLICER_MODE: "real",
      SLICER_URL: "http://slicer.test/",
      SLICER_TOKEN: "secret",
    },
    fetchImpl,
  });

  const result = await client.inspectModel({
    model: new File(["solid cube\nendsolid cube\n"], "cube.stl", {
      type: "model/stl",
    }),
    rotation: [0, 0, 0, 1],
    includeFaces: true,
  });

  assert.equal(seenRequest.url, "http://slicer.test/inspect");
  assert.equal(seenRequest.init.headers.Authorization, "Bearer secret");
  assert.equal(seenRequest.init.body.get("rotation"), "[0,0,0,1]");
  assert.equal(seenRequest.init.body.get("include_faces"), "true");
  assert.deepEqual(result.bounding_box_mm, { x: 10, y: 20, z: 30 });
  assert.equal(result.faces.length, 1);
});

test("mock inspect can return deterministic ranked faces", async () => {
  const client = new SlicerClient({
    env: { SLICER_MODE: "mock" },
  });

  const result = await client.inspectModel({
    model: new File(["solid cube\nendsolid cube\n"], "cube.stl", {
      type: "model/stl",
    }),
    includeFaces: true,
  });

  assert.equal(result.faces.length, 6);
  assert.equal(result.faces[0].rank, 1);
  assert.deepEqual(result.faces[0].quaternion_xyzw, [0, 0, 0, 1]);
});

test("pollJob follows queued to slicing to done", async () => {
  const statuses = ["queued", "slicing", "done"];
  const fetchImpl = async () => {
    const status = statuses.shift();
    return new Response(
      JSON.stringify({
        job_id: "job-1",
        status,
        result:
          status === "done" ? { print_time_s: 10, material_used_g: 1 } : null,
      }),
      { status: 200 },
    );
  };
  const client = new SlicerClient({
    env: {
      SLICER_MODE: "real",
      SLICER_URL: "http://slicer.test",
      SLICER_TOKEN: "secret",
    },
    fetchImpl,
    sleep: async () => {},
  });

  const job = await client.pollJob("job-1");

  assert.equal(job.status, "done");
});

test("pollJob backs off retryable busy errors", async () => {
  const sleeps = [];
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 1) {
      return new Response(
        JSON.stringify({
          error: {
            code: "SLICER_BUSY",
            message: "busy",
            retryable: true,
            details: {},
          },
        }),
        { status: 409 },
      );
    }
    return new Response(
      JSON.stringify({ job_id: "job-1", status: "done", result: {} }),
      {
        status: 200,
      },
    );
  };
  const client = new SlicerClient({
    env: {
      SLICER_MODE: "real",
      SLICER_URL: "http://slicer.test",
      SLICER_TOKEN: "secret",
    },
    fetchImpl,
    pollIntervalMs: 250,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });

  const job = await client.pollJob("job-1");

  assert.equal(job.status, "done");
  assert.deepEqual(sleeps, [250]);
});

test("structured service errors map to SlicerError", async () => {
  const client = new SlicerClient({
    env: {
      SLICER_MODE: "real",
      SLICER_URL: "http://slicer.test",
      SLICER_TOKEN: "secret",
    },
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          error: {
            code: "SLICER_INVALID_INPUT",
            message: "Only .stl model uploads are accepted.",
            retryable: false,
            details: {},
          },
        }),
        { status: 400 },
      ),
  });

  await assert.rejects(
    () => client.getJob("job-1"),
    (error) =>
      error instanceof SlicerError &&
      error.code === "SLICER_INVALID_INPUT" &&
      error.retryable === false,
  );
});
