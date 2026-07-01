import { MoonrakerError } from "./errors";

export type MoonrakerMode = "mock" | "local" | "hardware";

const HARDWARE_CONFIRMATION = "I_UNDERSTAND_THIS_CONTROLS_PHYSICAL_HARDWARE";

export function getMoonrakerMode(): MoonrakerMode {
  const value = process.env.MOONRAKER_MODE ?? "mock";
  if (value === "mock" || value === "local" || value === "hardware")
    return value;
  return "mock";
}

function assertLoopback(url: URL, printerId: string) {
  if (!["127.0.0.1", "localhost", "::1"].includes(url.hostname)) {
    throw new MoonrakerError({
      code: "UNSAFE_MOCK_URL",
      message: "Mock mode may connect only to a loopback Moonraker simulator.",
      retryable: false,
      printerId,
      details: url.origin,
    });
  }
}

export function resolveMoonrakerBaseUrl(input: {
  printerId: string;
  ip?: string;
  port?: number;
  mockBaseUrl?: string;
}): string {
  const mode = getMoonrakerMode();

  if (mode === "mock") {
    const url = new URL(
      input.mockBaseUrl ??
        process.env.MOCK_MOONRAKER_URL ??
        "http://127.0.0.1:7125",
    );
    assertLoopback(url, input.printerId);
    return url.origin;
  }

  if (mode === "local") {
    throw new MoonrakerError({
      code: "MOONRAKER_DISABLED",
      message:
        "Printer commands are disabled in local mode. Use mock mode for simulation.",
      retryable: false,
      printerId: input.printerId,
    });
  }

  if (process.env.HARDWARE_CONFIRMATION !== HARDWARE_CONFIRMATION) {
    throw new MoonrakerError({
      code: "HARDWARE_CONFIRMATION_REQUIRED",
      message: "Hardware control requires an explicit safety confirmation.",
      retryable: false,
      printerId: input.printerId,
    });
  }

  if (!input.ip || !input.port) {
    throw new MoonrakerError({
      code: "MOONRAKER_DISABLED",
      message: "This printer has no configured Moonraker address.",
      retryable: false,
      printerId: input.printerId,
    });
  }

  return `http://${input.ip}:${input.port}`;
}
