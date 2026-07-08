import { runGcodeScript } from "@/app/lib/moonraker";
import type { PrinterStatusType } from "@/app/types/printer";

export type MacroId = "start_print" | "tool_dock" | "pellet_refill" | "purge";

export interface MacroPrinter {
  ip: string;
  port: number;
}

export interface MacroStatus {
  status: PrinterStatusType | "unknown";
}

export interface CuratedMacro {
  id: MacroId;
  label: string;
  script: string;
  allowedStatuses: Array<PrinterStatusType | "unknown">;
}

export interface MacroAvailability extends CuratedMacro {
  enabled: boolean;
  reason: string | null;
}

export class MacroError extends Error {
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
    this.name = "MacroError";
    this.code = input.code;
    this.status = input.status ?? 400;
    this.retryable = input.retryable ?? false;
    this.details = input.details;
  }
}

export const CURATED_MACROS: CuratedMacro[] = [
  {
    id: "start_print",
    label: "START_PRINT",
    script: "START_PRINT",
    allowedStatuses: ["idle"],
  },
  {
    id: "tool_dock",
    label: "Tool Dock",
    script: "TOOL_DOCK",
    allowedStatuses: ["idle", "paused"],
  },
  {
    id: "pellet_refill",
    label: "Pellet Refill",
    script: "PELLET_REFILL",
    allowedStatuses: ["idle", "paused"],
  },
  {
    id: "purge",
    label: "Purge",
    script: "PURGE",
    allowedStatuses: ["idle", "paused"],
  },
];

function availabilityReason(
  macro: CuratedMacro,
  status: MacroStatus,
): string | null {
  if (macro.allowedStatuses.includes(status.status)) return null;
  if (status.status === "printing") return "Unavailable while printing.";
  if (status.status === "offline") return "Printer is offline.";
  if (status.status === "error") return "Clear the printer fault first.";
  return "Printer is not in a compatible state.";
}

export function listCuratedMacros(status: MacroStatus): MacroAvailability[] {
  return CURATED_MACROS.map((macro) => {
    const reason = availabilityReason(macro, status);
    return {
      ...macro,
      enabled: reason === null,
      reason,
    };
  });
}

export async function runCuratedMacro(
  printer: MacroPrinter,
  status: MacroStatus,
  macroId: string,
): Promise<MacroAvailability> {
  const macro = listCuratedMacros(status).find(
    (candidate) => candidate.id === macroId,
  );

  if (!macro) {
    throw new MacroError({
      code: "MACRO_NOT_FOUND",
      message: "Curated macro not found.",
      status: 404,
      details: { macro_id: macroId },
    });
  }

  if (!macro.enabled) {
    throw new MacroError({
      code: "MACRO_UNAVAILABLE",
      message: macro.reason ?? "Macro is unavailable.",
      status: 409,
      details: { macro_id: macroId, printer_status: status.status },
    });
  }

  await runGcodeScript(printer.ip, printer.port, macro.script);
  return macro;
}
