export type MoonrakerErrorCode =
  | "MOONRAKER_DISABLED"
  | "HARDWARE_CONFIRMATION_REQUIRED"
  | "UNSAFE_MOCK_URL"
  | "MOONRAKER_TIMEOUT"
  | "MOONRAKER_OFFLINE"
  | "MOONRAKER_REJECTED"
  | "MOONRAKER_MALFORMED_RESPONSE";

export interface MoonrakerErrorPayload {
  code: MoonrakerErrorCode;
  message: string;
  retryable: boolean;
  printerId: string;
  details?: string;
}

export class MoonrakerError extends Error {
  readonly code: MoonrakerErrorCode;
  readonly retryable: boolean;
  readonly printerId: string;
  readonly details?: string;

  constructor(payload: MoonrakerErrorPayload) {
    super(payload.message);
    this.name = "MoonrakerError";
    this.code = payload.code;
    this.retryable = payload.retryable;
    this.printerId = payload.printerId;
    this.details = payload.details;
  }

  toJSON(): MoonrakerErrorPayload {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      printerId: this.printerId,
      ...(this.details ? { details: this.details } : {}),
    };
  }
}

export function normalizeMoonrakerError(
  error: unknown,
  printerId: string,
): MoonrakerError {
  if (error instanceof MoonrakerError) return error;

  if (error instanceof DOMException && error.name === "TimeoutError") {
    return new MoonrakerError({
      code: "MOONRAKER_TIMEOUT",
      message: "The printer did not respond in time.",
      retryable: true,
      printerId,
      details: error.message,
    });
  }

  return new MoonrakerError({
    code: "MOONRAKER_OFFLINE",
    message: "The printer could not be reached.",
    retryable: true,
    printerId,
    details: error instanceof Error ? error.message : String(error),
  });
}
