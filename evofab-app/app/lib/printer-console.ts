import { runGcodeScript } from "@/app/lib/moonraker";

export interface ConsolePrinter {
  ip: string;
  port: number;
}

export interface ConsoleResult {
  command: string;
  response: string;
}

export class ConsoleError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryable: boolean;
  readonly details?: unknown;

  constructor(input: {
    code: string;
    message: string;
    status?: number;
    retryable?: boolean;
    details?: unknown;
  }) {
    super(input.message);
    this.name = "ConsoleError";
    this.code = input.code;
    this.status = input.status ?? 400;
    this.retryable = input.retryable ?? false;
    this.details = input.details;
  }
}

const DENIED_COMMANDS = new Set([
  "M112",
  "RESTART",
  "FIRMWARE_RESTART",
  "SAVE_CONFIG",
]);

function normalizeCommand(input: unknown): string {
  if (typeof input !== "string" || input.trim().length === 0) {
    throw new ConsoleError({
      code: "CONSOLE_INVALID_COMMAND",
      message: "Enter a G-code command before sending.",
    });
  }

  const command = input.trim();
  const lines = command.split(/\r?\n/);
  for (const line of lines) {
    const stripped = line.trim();
    if (!stripped || stripped.startsWith(";")) continue;
    if (!/^[A-Za-z_][A-Za-z0-9_]*(?:\s|$)/.test(stripped)) {
      throw new ConsoleError({
        code: "CONSOLE_INVALID_COMMAND",
        message: "Console command is malformed.",
        details: { line: stripped },
      });
    }
    const token = stripped.split(/\s+/, 1)[0].toUpperCase();
    if (DENIED_COMMANDS.has(token)) {
      throw new ConsoleError({
        code: "CONSOLE_DENIED_COMMAND",
        message:
          `${token} is guarded. Use the dedicated printer control UI for restart, firmware restart, save config, or emergency stop.`,
        status: 403,
        details: { command: token },
      });
    }
  }

  return command;
}

export async function sendConsoleCommand(
  printer: ConsolePrinter,
  input: unknown,
): Promise<ConsoleResult> {
  const command = normalizeCommand(input);
  await runGcodeScript(printer.ip, printer.port, command);
  return {
    command,
    response: "Command accepted by Moonraker gcode/script.",
  };
}
