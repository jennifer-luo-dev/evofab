import fs from "node:fs";
import { PathLike } from "node:fs";
import { URL } from "node:url";

// Sanitizer function
export function sanitizeOutput(text: string, customSecrets: string[] = []): string {
  let sanitized = text;

  // 1. IP Addresses (IPv4)
  sanitized = sanitized.replace(/\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b/g, "<IP_ADDRESS>");

  // 2. Hostnames (e.g., .tufts.edu, strix, local hostnames)
  sanitized = sanitized.replace(/\b[a-zA-Z0-9.-]+\.tufts\.edu\b/gi, "<TUFTS_HOST>");

  // 3. API Key headers / Auth tokens (case-insensitive)
  sanitized = sanitized.replace(/(x-api-key\s*:\s*["']?)[a-zA-Z0-9_-]+/gi, "$1<API_KEY>");
  sanitized = sanitized.replace(/(authorization\s*:\s*["']?Bearer\s+)[a-zA-Z0-9._-]+/gi, "$1<TOKEN>");

  // 4. Serials (alphanumeric, e.g. Buddy board or printer serials, typically 16-20 chars)
  sanitized = sanitized.replace(/\b[a-zA-Z0-9]{16,20}\b/g, "<SERIAL_NUMBER>");

  // 5. File paths (Unix and Windows paths)
  sanitized = sanitized.replace(/(?:[a-zA-Z]:[\\/]|[\\/])(?:[a-zA-Z0-9._-]+[\\/])+[a-zA-Z0-9._-]+/g, "<FILE_PATH>");

  // 6. Custom secrets (like the API key itself)
  for (const secret of customSecrets) {
    if (secret && secret.length > 2) {
      // Escape regex special chars
      const escaped = secret.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");
      const regex = new RegExp(escaped, "g");
      sanitized = sanitized.replace(regex, "<SECRET>");
    }
  }

  return sanitized;
}

// Argument parser
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

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--host" && i + 1 < argv.length) {
      host = argv[++i];
    } else if (arg === "--key-file" && i + 1 < argv.length) {
      keyFile = argv[++i];
    } else if (arg === "--samples" && i + 1 < argv.length) {
      samples = parseInt(argv[++i], 10);
    } else if (arg === "--interval" && i + 1 < argv.length) {
      interval = parseFloat(argv[++i]);
    }
  }

  return { host, keyFile, samples, interval };
}

// Helper to query one endpoint
async function queryEndpoint(
  host: string,
  path: string,
  key: string,
  timeoutMs: number = 5000
): Promise<{ status: number; latencyMs: number; summary: string; error?: string }> {
  const url = `http://${host}${path}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const start = Date.now();

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "X-Api-Key": key,
        "Accept": "application/json",
      },
      signal: controller.signal,
    });

    const latencyMs = Date.now() - start;
    clearTimeout(timeoutId);

    if (response.status === 204) {
      return {
        status: response.status,
        latencyMs,
        summary: "HTTP 204: No Content (Idle/Ready)",
      };
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return {
        status: response.status,
        latencyMs,
        summary: `Error: HTTP ${response.status}`,
        error: `HTTP_${response.status}: ${text.substring(0, 100)}`,
      };
    }

    const data = await response.json();
    let summary = "";
    if (path === "/api/version") {
      summary = `api: ${data.api || "unknown"}, server: ${data.server || "unknown"}`;
    } else if (path === "/api/v1/info") {
      summary = `name: ${data.name || "unknown"}, model: ${data.model || "unknown"}, mcode: ${data.mcode || "unknown"}`;
    } else if (path === "/api/v1/status") {
      const printState = data.printer?.state || "unknown";
      const tempNozzle = data.temp?.nozzle || 0;
      const tempBed = data.temp?.bed || 0;
      summary = `state: ${printState}, nozzle: ${tempNozzle}°C, bed: ${tempBed}°C`;
    } else if (path === "/api/v1/job") {
      summary = `job_id: ${data.id || "none"}, state: ${data.state || "unknown"}, progress: ${data.progress || 0}%`;
    } else if (path === "/api/v1/storage") {
      const mount = data.mounts?.[0]?.name || "unknown";
      const filesCount = data.mounts?.[0]?.files?.length || 0;
      summary = `mount: ${mount}, files: ${filesCount}`;
    } else {
      summary = JSON.stringify(data).substring(0, 80);
    }

    return { status: response.status, latencyMs, summary };
  } catch (err: any) {
    clearTimeout(timeoutId);
    const latencyMs = Date.now() - start;
    let errorCategory = "NETWORK_ERROR";
    if (err.name === "AbortError") {
      errorCategory = "TIMEOUT";
    }
    return {
      status: 0,
      latencyMs,
      summary: "Connection failed",
      error: `${errorCategory}: ${err.message || String(err)}`,
    };
  }
}

// Main execution block (only runs if script is executed directly)
const isMain = require.main === module || (process.argv[1] && (process.argv[1].endsWith("prusalink-probe.ts") || process.argv[1].endsWith("prusalink-probe")));
if (isMain) {
  const args = parseArgs(process.argv.slice(2));

  if (!args.host) {
    console.error("Error: --host is required.");
    console.log("Usage: npx tsx scripts/prusalink-probe.ts --host <IP_OR_NAME> [--key-file <PATH>] [--samples N] [--interval S]");
    process.exit(1);
  }

  // Resolve API Key file or environment variable
  let keyFilePath = args.keyFile;
  if (!keyFilePath && process.env.PRUSALINK_KEY_FILE) {
    keyFilePath = process.env.PRUSALINK_KEY_FILE;
  }
  if (!keyFilePath) {
    keyFilePath = ".secrets/prusalink.key";
  }

  let apiKey = "";
  if (fs.existsSync(keyFilePath)) {
    apiKey = fs.readFileSync(keyFilePath, "utf8").trim();
  }

  if (!apiKey) {
    console.warn(`Warning: No API key found in ${keyFilePath}. Using empty key.`);
  }

  const customSecrets = apiKey ? [apiKey] : [];

  console.log(sanitizeOutput(`Starting PrusaLink probe on host: ${args.host} (samples: ${args.samples}, interval: ${args.interval}s)`, customSecrets));

  const endpoints = [
    "/api/version",
    "/api/v1/info",
    "/api/v1/status",
    "/api/v1/job",
    "/api/v1/storage",
  ];

  const runProbe = async () => {
    const timestamp = new Date().toISOString();
    const results: string[] = [];

    for (const path of endpoints) {
      const result = await queryEndpoint(args.host, path, apiKey);
      const logLine = `[${timestamp}] GET ${path} -> HTTP ${result.status} | Latency: ${result.latencyMs}ms | Summary: ${result.summary}${result.error ? ` | Error: ${result.error}` : ""}`;
      results.push(sanitizeOutput(logLine, customSecrets));
    }

    console.log(results.join("\n"));
  };

  const runStatusPollLoop = async () => {
    let count = 0;
    const intervalMs = args.interval * 1000;

    const poll = async () => {
      const timestamp = new Date().toISOString();
      const result = await queryEndpoint(args.host, "/api/v1/status", apiKey);
      const logLine = `[${timestamp}] Sample ${count + 1}/${args.samples} | GET /api/v1/status -> HTTP ${result.status} | Latency: ${result.latencyMs}ms | Summary: ${result.summary}${result.error ? ` | Error: ${result.error}` : ""}`;
      console.log(sanitizeOutput(logLine, customSecrets));

      count++;
      if (count < args.samples) {
        setTimeout(poll, intervalMs);
      } else {
        console.log("Polling completed.");
      }
    };

    poll();
  };

  if (args.samples > 1) {
    runStatusPollLoop();
  } else {
    runProbe();
  }
}
