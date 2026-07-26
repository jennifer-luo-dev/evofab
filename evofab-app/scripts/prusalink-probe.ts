import "dotenv/config";
import {
  PrusaLinkClientError,
  readPrusaLinkKey,
  requestPrusaLink,
  sanitizePrusaLinkOutput,
} from "@/app/lib/prusalink-client";

export const sanitizeOutput = sanitizePrusaLinkOutput;

export interface ProbeArgs {
  host: string;
  keyFile: string;
  samples: number;
  interval: number;
}

export function parseArgs(argv: string[]): ProbeArgs {
  let host = "";
  let keyFile = "";
  let samples = 1;
  let interval = 2;
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index + 1];
    if (argv[index] === "--host" && value) host = argv[++index];
    else if (argv[index] === "--key-file" && value) keyFile = argv[++index];
    else if (argv[index] === "--samples" && value)
      samples = Number.parseInt(argv[++index], 10);
    else if (argv[index] === "--interval" && value)
      interval = Number.parseFloat(argv[++index]);
  }
  if (!Number.isInteger(samples) || samples < 1) samples = 1;
  if (!Number.isFinite(interval) || interval < 0) interval = 2;
  return { host, keyFile, samples, interval };
}

const ENDPOINTS = [
  "/api/version",
  "/api/v1/info",
  "/api/v1/status",
  "/api/v1/job",
  "/api/v1/storage",
] as const;

function summarize(path: string, data: unknown, status: number): string {
  if (status === 204) return "HTTP 204: No Content (Idle/Ready)";
  const body = (data ?? {}) as Record<string, unknown>;
  if (path === "/api/v1/status") {
    const printer = (body.printer ?? {}) as Record<string, unknown>;
    const temp = (body.temp ?? {}) as Record<string, unknown>;
    return `state: ${printer.state ?? "unknown"}, nozzle: ${temp.nozzle ?? 0}°C, bed: ${temp.bed ?? 0}°C`;
  }
  if (path === "/api/v1/job") {
    return `state: ${body.state ?? "unknown"}, progress: ${body.progress ?? 0}%`;
  }
  return JSON.stringify(body).slice(0, 160);
}

async function probeEndpoint(
  host: string,
  path: string,
  key: string,
): Promise<string> {
  try {
    const result = await requestPrusaLink<unknown>({ host, path, key });
    return `GET ${path} -> HTTP ${result.status} | Latency: ${result.latencyMs}ms | Summary: ${summarize(path, result.data, result.status)}`;
  } catch (error) {
    const category =
      error instanceof PrusaLinkClientError
        ? error.category
        : "PRUSALINK_NETWORK";
    return `GET ${path} -> HTTP 0 | Latency: 0ms | Summary: Connection failed | Error: ${category}`;
  }
}

export async function runProbe(args: ProbeArgs): Promise<void> {
  const keyFile = args.keyFile || process.env.PRUSALINK_KEY_FILE || "";
  const key = await readPrusaLinkKey(keyFile);
  const secrets = [key];
  console.log(
    sanitizeOutput(
      `Starting PrusaLink probe on host: ${args.host} (samples: ${args.samples}, interval: ${args.interval}s)`,
      secrets,
    ),
  );

  if (args.samples === 1) {
    for (const path of ENDPOINTS) {
      const line = await probeEndpoint(args.host, path, key);
      console.log(
        sanitizeOutput(`[${new Date().toISOString()}] ${line}`, secrets),
      );
    }
    return;
  }

  for (let sample = 1; sample <= args.samples; sample += 1) {
    const line = await probeEndpoint(args.host, "/api/v1/status", key);
    console.log(
      sanitizeOutput(
        `[${new Date().toISOString()}] Sample ${sample}/${args.samples} | ${line}`,
        secrets,
      ),
    );
    if (sample < args.samples) {
      await new Promise((resolve) =>
        setTimeout(resolve, args.interval * 1_000),
      );
    }
  }
  console.log("Polling completed.");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.host) throw new Error("--host is required");
  await runProbe(args);
}

const isMain = process.argv[1]?.endsWith("prusalink-probe.ts");
if (isMain) {
  void main().catch((error: unknown) => {
    const category =
      error instanceof PrusaLinkClientError ? error.category : "PROBE_FAILED";
    console.error(category);
    process.exitCode = 1;
  });
}
