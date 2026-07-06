export type SlicerErrorCode =
  | "SLICER_BUSY"
  | "SLICER_ENGINE_FAILED"
  | "SLICER_INVALID_INPUT"
  | "SLICER_JOB_NOT_FOUND"
  | "SLICER_MALFORMED_OUTPUT"
  | "SLICER_NETWORK_ERROR"
  | "SLICER_PROFILE_NOT_FOUND"
  | "SLICER_TIMEOUT"
  | "SLICER_UNAUTHORIZED"
  | "SLICER_UNCONFIGURED";

interface SlicerErrorOptions {
  code: SlicerErrorCode;
  message: string;
  retryable: boolean;
  details?: unknown;
  status?: number;
}

export class SlicerError extends Error {
  readonly code: SlicerErrorCode;
  readonly retryable: boolean;
  readonly details?: unknown;
  readonly status?: number;

  constructor({
    code,
    message,
    retryable,
    details,
    status,
  }: SlicerErrorOptions) {
    super(message);
    this.name = "SlicerError";
    this.code = code;
    this.retryable = retryable;
    this.details = details;
    this.status = status;
  }
}

interface SlicerErrorResponse {
  error?: {
    code?: string;
    message?: string;
    retryable?: boolean;
    details?: unknown;
  };
}

export function errorFromSlicerResponse(
  status: number,
  body: SlicerErrorResponse | null,
  fallbackText = "",
): SlicerError {
  const error = body?.error;

  if (error?.code?.startsWith("SLICER_")) {
    return new SlicerError({
      code: error.code as SlicerErrorCode,
      message: error.message ?? "Slicer service rejected the request.",
      retryable: error.retryable ?? false,
      details: error.details,
      status,
    });
  }

  return new SlicerError({
    code: status === 409 ? "SLICER_BUSY" : "SLICER_NETWORK_ERROR",
    message: fallbackText || `Slicer service returned HTTP ${status}.`,
    retryable: status === 409 || status >= 500,
    details: fallbackText,
    status,
  });
}

export function normalizeSlicerError(error: unknown): SlicerError {
  if (error instanceof SlicerError) return error;

  if (error instanceof DOMException && error.name === "TimeoutError") {
    return new SlicerError({
      code: "SLICER_TIMEOUT",
      message: "Slicer request timed out.",
      retryable: true,
      details: error.message,
    });
  }

  if (error instanceof Error && error.name === "AbortError") {
    return new SlicerError({
      code: "SLICER_TIMEOUT",
      message: "Slicer request timed out.",
      retryable: true,
      details: error.message,
    });
  }

  return new SlicerError({
    code: "SLICER_NETWORK_ERROR",
    message: "Slicer service is unavailable.",
    retryable: true,
    details: error instanceof Error ? error.message : String(error),
  });
}
