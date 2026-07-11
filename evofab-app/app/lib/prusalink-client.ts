import { readFile } from "node:fs/promises";
import type { PrinterDriverErrorCategory } from "@/app/lib/printer-driver";

export const DEFAULT_PRUSALINK_TIMEOUT_MS = 5_000;

export class PrusaLinkClientError extends Error {
  constructor(
    readonly category: PrinterDriverErrorCategory,
    readonly status: number | null = null,
  ) {
    super(category);
    this.name = "PrusaLinkClientError";
  }
}

export function sanitizePrusaLinkOutput(
  text: string,
  secrets: string[] = [],
): string {
  let sanitized = text
    .replace(/\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b/g, "<IP_ADDRESS>")
    .replace(/\b[a-zA-Z0-9.-]+\.tufts\.edu\b/gi, "<TUFTS_HOST>")
    .replace(/(x-api-key\s*:\s*["']?)[^\s,}"']+/gi, "$1<API_KEY>")
    .replace(/(authorization\s*:\s*["']?Bearer\s+)[^\s,}"']+/gi, "$1<TOKEN>")
    .replace(/\b[a-zA-Z0-9]{16,20}\b/g, "<SERIAL_NUMBER>")
    .replace(
      /(?:[a-zA-Z]:[\\/]|[\\/])(?:[a-zA-Z0-9._-]+[\\/])+[a-zA-Z0-9._-]+/g,
      "<FILE_PATH>",
    );

  for (const secret of secrets) {
    if (secret.length > 2) sanitized = sanitized.replaceAll(secret, "<SECRET>");
  }
  return sanitized;
}

export async function readPrusaLinkKey(keyFile: string): Promise<string> {
  if (!keyFile.trim()) throw new PrusaLinkClientError("PRUSALINK_CONFIG");
  try {
    const key = (await readFile(keyFile, "utf8")).trim();
    if (!key) throw new PrusaLinkClientError("PRUSALINK_CONFIG");
    return key;
  } catch (error) {
    if (error instanceof PrusaLinkClientError) throw error;
    throw new PrusaLinkClientError("PRUSALINK_CONFIG");
  }
}

export interface PrusaLinkResponse<T> {
  status: number;
  latencyMs: number;
  data: T | null;
}

export async function requestPrusaLink<T>(options: {
  host: string;
  path: string;
  key: string;
  method?: "GET" | "PUT" | "POST" | "DELETE";
  body?: BodyInit;
  headers?: Record<string, string>;
  expectedStatuses?: number[];
  parseJson?: boolean;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<PrusaLinkResponse<T>> {
  const startedAt = Date.now();
  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(`http://${options.host}${options.path}`, {
      method: options.method ?? "GET",
      headers: {
        "X-Api-Key": options.key,
        Accept: "application/json",
        ...options.headers,
      },
      body: options.body,
      cache: "no-store",
      signal: AbortSignal.timeout(
        options.timeoutMs ?? DEFAULT_PRUSALINK_TIMEOUT_MS,
      ),
    });
    const latencyMs = Date.now() - startedAt;
    const expected = options.expectedStatuses ?? [200, 204];
    if (
      expected.includes(response.status) &&
      (response.status === 204 || options.parseJson === false)
    ) {
      return { status: response.status, latencyMs, data: null };
    }
    if (response.status === 401 || response.status === 403) {
      throw new PrusaLinkClientError("PRUSALINK_AUTH", response.status);
    }
    if (response.status >= 500) {
      throw new PrusaLinkClientError("PRUSALINK_SERVER", response.status);
    }
    if (response.status === 404)
      throw new PrusaLinkClientError("PRUSALINK_NOT_FOUND", response.status);
    if (response.status === 409)
      throw new PrusaLinkClientError("PRUSALINK_CONFLICT", response.status);
    if (!expected.includes(response.status))
      throw new PrusaLinkClientError("PRUSALINK_NETWORK");
    try {
      return {
        status: response.status,
        latencyMs,
        data: (await response.json()) as T,
      };
    } catch {
      throw new PrusaLinkClientError("PRUSALINK_MALFORMED_RESPONSE");
    }
  } catch (error) {
    if (error instanceof PrusaLinkClientError) throw error;
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new PrusaLinkClientError("PRUSALINK_TIMEOUT");
    }
    throw new PrusaLinkClientError("PRUSALINK_NETWORK");
  }
}
