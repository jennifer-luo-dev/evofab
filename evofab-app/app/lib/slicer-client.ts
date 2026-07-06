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

export const MOCK_GCODE_FIXTURE = [
  "; EvoFab mock GingerSlicer fixture",
  "START_PRINT BED_TEMPERATURE=60 EXTRUDER_TEMPERATURE=190 EXTRUDER_ROTATION_VOLUME=210",
  "G1 X0 Y0 Z1.2 F3000",
  "G1 X20 Y0 E4.2 F900",
  "G1 X20 Y20 E8.4 F900",
  "G1 X0 Y20 E12.6 F900",
  "G1 X0 Y0 E16.8 F900",
  "END_PRINT",
  "",
].join("\n");

const MOCK_RESULT: SlicerJobResult = {
  gcode_url: "/mock/gcode",
  print_time_s: 1039,
  material_used_mm3: 14032.26,
  material_used_g: 17.42,
  engine: "mock",
  profile_id: "pla-virgin-3mm",
};

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
      return {
        job_id: `${MOCK_JOB_ID_PREFIX}-${Date.now()}`,
        status: "queued",
      };
    }

    const form = new FormData();
    form.append("model", input.model, input.model.name);
    form.append("profile_id", input.profileId);

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
        result: MOCK_RESULT,
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
      return MOCK_GCODE_FIXTURE;
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

      return response.text();
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
