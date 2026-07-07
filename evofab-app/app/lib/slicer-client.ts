import { resolveSlicerConfig } from "./slicer-config";
import {
  SlicerError,
  errorFromSlicerResponse,
  normalizeSlicerError,
} from "./slicer-errors";

export type SlicerJobStatus = "queued" | "slicing" | "done" | "failed";

export interface SlicerHealth {
  status: string;
  engine: string;
  mode: string;
  queue_depth: number;
  source: string;
}

export interface SlicerJobResult {
  gcode_url: string;
  print_time_s: number;
  material_used_mm3: number;
  material_used_g: number;
  engine: string;
  profile_id: string;
  rotation?: number[] | null;
  drop_to_bed?: boolean;
  transformed_bounding_box_mm?: BoundingBoxMm | null;
  supports?: boolean | null;
}

export interface SlicerJob {
  job_id: string;
  status: SlicerJobStatus;
  created_at?: string;
  started_at?: string | null;
  finished_at?: string | null;
  result?: SlicerJobResult | null;
  error?: unknown;
}

export interface SlicerSubmitResponse {
  job_id: string;
  status: "queued";
}

export interface SubmitSliceInput {
  model: File;
  profileId: string;
  rotation?: number[] | null;
  supports?: boolean;
}

export interface BoundingBoxMm {
  x: number;
  y: number;
  z: number;
}

export interface SlicerInspectResult {
  bounding_box_mm: BoundingBoxMm;
  is_watertight: boolean;
  overhang_ratio: number;
  triangle_count: number;
  faces?: SlicerFace[];
}

export interface SlicerFace {
  id: string;
  rank: number;
  normal: [number, number, number];
  area_mm2: number;
  centroid_mm: [number, number, number];
  triangle_indices: number[];
  quaternion_xyzw: [number, number, number, number];
}

export interface InspectModelInput {
  model: File;
  rotation?: number[] | null;
  includeFaces?: boolean;
}

export interface SlicerClientOptions {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  pollIntervalMs?: number;
  maxPollMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const MOCK_JOB_ID_PREFIX = "mock-slicer-job";
const MOCK_TOTAL_LAYERS = 48;
const mockJobs = new Map<string, SlicerJobResult>();

function buildMockGcodeFixture(totalLayers = MOCK_TOTAL_LAYERS): string {
  const lines = [
    "; EvoFab mock pellet slicer fixture",
    "START_PRINT BED_TEMPERATURE=60 EXTRUDER_TEMPERATURE=190 EXTRUDER_ROTATION_VOLUME=210",
    `SET_PRINT_STATS_INFO TOTAL_LAYER=${totalLayers}`,
  ];
  let e = 0;

  for (let layer = 0; layer < totalLayers; layer += 1) {
    const z = 1.2 + layer * 0.8;
    const inset = layer % 6;
    const min = inset;
    const max = 24 - inset;
    lines.push(`;LAYER:${layer}`);
    lines.push(`G1 Z${z.toFixed(2)} F3000`);
    lines.push(
      layer >= totalLayers - 4 ? ";TYPE:Top surface" : ";TYPE:Outer wall",
    );
    lines.push(`G1 X${min.toFixed(2)} Y${min.toFixed(2)} F1800`);
    e += 1.2;
    lines.push(
      `G1 X${max.toFixed(2)} Y${min.toFixed(2)} E${e.toFixed(4)} F900`,
    );
    e += 1.2;
    lines.push(
      `G1 X${max.toFixed(2)} Y${max.toFixed(2)} E${e.toFixed(4)} F900`,
    );
    e += 1.2;
    lines.push(
      `G1 X${min.toFixed(2)} Y${max.toFixed(2)} E${e.toFixed(4)} F900`,
    );
    e += 1.2;
    lines.push(
      `G1 X${min.toFixed(2)} Y${min.toFixed(2)} E${e.toFixed(4)} F900`,
    );

    const infillMin = min + 3;
    const infillMax = max - 3;
    if (infillMax > infillMin) {
      lines.push(";TYPE:Sparse infill");
      for (let offset = infillMin; offset <= infillMax; offset += 4) {
        if (layer % 2 === 0) {
          lines.push(`G1 X${infillMin.toFixed(2)} Y${offset.toFixed(2)} F1800`);
          e += 0.9;
          lines.push(
            `G1 X${infillMax.toFixed(2)} Y${offset.toFixed(2)} E${e.toFixed(4)} F900`,
          );
        } else {
          lines.push(`G1 X${offset.toFixed(2)} Y${infillMin.toFixed(2)} F1800`);
          e += 0.9;
          lines.push(
            `G1 X${offset.toFixed(2)} Y${infillMax.toFixed(2)} E${e.toFixed(4)} F900`,
          );
        }
      }
    }
  }

  lines.push("END_PRINT", "");
  return lines.join("\n");
}

export const MOCK_GCODE_FIXTURE = buildMockGcodeFixture();

const MOCK_RESULT: SlicerJobResult = {
  gcode_url: "/mock/gcode",
  print_time_s: 1039,
  material_used_mm3: 14032.26,
  material_used_g: 17.42,
  engine: "mock",
  profile_id: "pla-fgf",
  rotation: null,
  drop_to_bed: true,
  transformed_bounding_box_mm: { x: 24, y: 24, z: 40 },
  supports: null,
};

function mockInspectResult(input: InspectModelInput): SlicerInspectResult {
  const name = input.model.name.toLowerCase();
  const rotated = Boolean(input.rotation);
  const result: SlicerInspectResult = {
    bounding_box_mm: name.includes("oversize")
      ? { x: 999, y: 24, z: 40 }
      : rotated
        ? { x: 24, y: 40, z: 24 }
        : { x: 24, y: 24, z: 40 },
    is_watertight: !name.includes("leaky"),
    overhang_ratio: name.includes("high-overhang")
      ? 0.62
      : name.includes("flat") || rotated
        ? 0.08
        : 0.2,
    triangle_count: 12,
  };
  if (input.includeFaces) {
    result.faces = [
      {
        id: "face-0",
        rank: 1,
        normal: [0, 0, -1],
        area_mm2: 576,
        centroid_mm: [12, 12, 0],
        triangle_indices: [0, 1],
        quaternion_xyzw: [0, 0, 0, 1],
      },
      {
        id: "face-1",
        rank: 2,
        normal: [0, 0, 1],
        area_mm2: 576,
        centroid_mm: [12, 12, 24],
        triangle_indices: [2, 3],
        quaternion_xyzw: [1, 0, 0, 0],
      },
      {
        id: "face-2",
        rank: 3,
        normal: [1, 0, 0],
        area_mm2: 576,
        centroid_mm: [24, 12, 12],
        triangle_indices: [4, 5],
        quaternion_xyzw: [0, 0.707107, 0, 0.707107],
      },
      {
        id: "face-3",
        rank: 4,
        normal: [-1, 0, 0],
        area_mm2: 576,
        centroid_mm: [0, 12, 12],
        triangle_indices: [6, 7],
        quaternion_xyzw: [0, -0.707107, 0, 0.707107],
      },
      {
        id: "face-4",
        rank: 5,
        normal: [0, 1, 0],
        area_mm2: 576,
        centroid_mm: [12, 24, 12],
        triangle_indices: [8, 9],
        quaternion_xyzw: [0.707107, 0, 0, 0.707107],
      },
      {
        id: "face-5",
        rank: 6,
        normal: [0, -1, 0],
        area_mm2: 576,
        centroid_mm: [12, 0, 12],
        triangle_indices: [10, 11],
        quaternion_xyzw: [-0.707107, 0, 0, 0.707107],
      },
    ];
  }
  return result;
}

async function parseJsonSafely(text: string): Promise<unknown> {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function readResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  const json = (await parseJsonSafely(text)) as T | null;

  if (!response.ok) {
    throw errorFromSlicerResponse(
      response.status,
      json as {
        error?: {
          code?: string;
          message?: string;
          retryable?: boolean;
          details?: unknown;
        };
      } | null,
      text,
    );
  }

  return json as T;
}

function isMockJobId(jobId: string): boolean {
  return jobId.startsWith(MOCK_JOB_ID_PREFIX);
}

export function injectPrintStatsInfo(gcode: string, totalLayer = 48): string {
  if (/^SET_PRINT_STATS_INFO\b/im.test(gcode)) return gcode;

  const lines = gcode.split(/\r?\n/);
  const startPrintIndex = lines.findIndex((line) =>
    /^START_PRINT\b/i.test(line),
  );
  const insertAt = startPrintIndex >= 0 ? startPrintIndex + 1 : 0;
  const nextLines = [...lines];
  nextLines.splice(
    insertAt,
    0,
    `SET_PRINT_STATS_INFO TOTAL_LAYER=${totalLayer}`,
  );
  return nextLines.join("\n");
}

export class SlicerClient {
  private readonly config: ReturnType<typeof resolveSlicerConfig>;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly pollIntervalMs: number;
  private readonly maxPollMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: SlicerClientOptions = {}) {
    this.config = resolveSlicerConfig(options.env);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs =
      options.timeoutMs ?? Number(process.env.SLICER_TIMEOUT_MS ?? 10_000);
    this.pollIntervalMs = options.pollIntervalMs ?? 1_000;
    this.maxPollMs = options.maxPollMs ?? 90_000;
    this.sleep =
      options.sleep ??
      ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async health(): Promise<SlicerHealth> {
    if (this.config.mode === "mock") {
      return {
        status: "ok",
        engine: "mock",
        mode: "mock",
        queue_depth: 0,
        source: "mock",
      };
    }

    try {
      const response = await this.fetchImpl(`${this.config.url}/health`, {
        cache: "no-store",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      return await readResponse<SlicerHealth>(response);
    } catch (error) {
      throw normalizeSlicerError(error);
    }
  }

  async submitSlice(input: SubmitSliceInput): Promise<SlicerSubmitResponse> {
    if (this.config.mode === "mock") {
      const jobId = `${MOCK_JOB_ID_PREFIX}-${Date.now()}`;
      mockJobs.set(jobId, {
        ...MOCK_RESULT,
        profile_id: input.profileId,
        rotation: input.rotation ?? null,
        transformed_bounding_box_mm: mockInspectResult(input).bounding_box_mm,
        supports: input.supports ?? null,
      });
      return {
        job_id: jobId,
        status: "queued",
      };
    }

    const form = new FormData();
    form.append("model", input.model, input.model.name);
    form.append("profile_id", input.profileId);
    if (input.rotation) form.append("rotation", JSON.stringify(input.rotation));
    if (input.supports !== undefined)
      form.append("supports", String(input.supports));

    try {
      const response = await this.fetchImpl(`${this.config.url}/slice`, {
        method: "POST",
        body: form,
        headers: {
          Authorization: `Bearer ${this.config.token}`,
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      return await readResponse<SlicerSubmitResponse>(response);
    } catch (error) {
      throw normalizeSlicerError(error);
    }
  }

  async getJob(jobId: string): Promise<SlicerJob> {
    if (this.config.mode === "mock" || isMockJobId(jobId)) {
      return {
        job_id: jobId,
        status: "done",
        result: mockJobs.get(jobId) ?? MOCK_RESULT,
      };
    }

    try {
      const response = await this.fetchImpl(
        `${this.config.url}/jobs/${jobId}`,
        {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${this.config.token}`,
          },
          signal: AbortSignal.timeout(this.timeoutMs),
        },
      );
      return await readResponse<SlicerJob>(response);
    } catch (error) {
      throw normalizeSlicerError(error);
    }
  }

  async fetchGcode(jobId: string): Promise<string> {
    if (this.config.mode === "mock" || isMockJobId(jobId)) {
      return injectPrintStatsInfo(MOCK_GCODE_FIXTURE);
    }

    try {
      const response = await this.fetchImpl(
        `${this.config.url}/jobs/${jobId}/gcode`,
        {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${this.config.token}`,
          },
          signal: AbortSignal.timeout(this.timeoutMs),
        },
      );

      if (!response.ok) {
        const text = await response.text();
        const json = (await parseJsonSafely(text)) as {
          error?: {
            code?: string;
            message?: string;
            retryable?: boolean;
            details?: unknown;
          };
        } | null;
        throw errorFromSlicerResponse(response.status, json, text);
      }

      return injectPrintStatsInfo(await response.text());
    } catch (error) {
      throw normalizeSlicerError(error);
    }
  }

  async inspectModel(input: InspectModelInput): Promise<SlicerInspectResult> {
    if (this.config.mode === "mock") {
      return mockInspectResult(input);
    }

    const form = new FormData();
    form.append("model", input.model, input.model.name);
    if (input.rotation) form.append("rotation", JSON.stringify(input.rotation));
    if (input.includeFaces) form.append("include_faces", "true");

    try {
      const response = await this.fetchImpl(`${this.config.url}/inspect`, {
        method: "POST",
        body: form,
        headers: {
          Authorization: `Bearer ${this.config.token}`,
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      return await readResponse<SlicerInspectResult>(response);
    } catch (error) {
      throw normalizeSlicerError(error);
    }
  }

  async pollJob(jobId: string): Promise<SlicerJob> {
    const startedAt = Date.now();
    let delayMs = this.pollIntervalMs;

    while (Date.now() - startedAt <= this.maxPollMs) {
      try {
        const job = await this.getJob(jobId);
        if (job.status === "done" || job.status === "failed") return job;
        await this.sleep(this.pollIntervalMs);
        delayMs = this.pollIntervalMs;
      } catch (error) {
        const normalized = normalizeSlicerError(error);
        if (!normalized.retryable) throw normalized;
        await this.sleep(delayMs);
        delayMs = Math.min(delayMs * 2, 8_000);
      }
    }

    throw new SlicerError({
      code: "SLICER_TIMEOUT",
      message: "Timed out waiting for slicer job.",
      retryable: true,
      details: { job_id: jobId, timeout_ms: this.maxPollMs },
    });
  }
}
