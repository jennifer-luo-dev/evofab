import { runGcodeScript } from "@/app/lib/moonraker";
import { filterMaterialProfilesForPrinterType } from "@/app/lib/material-profiles";
import type { MaterialProfile } from "@/app/types/job";
import type { PrinterStatusType, PrinterType } from "@/app/types/printer";

export type PreheatPresetId = `profile:${string}` | "cooldown";

export interface PreheatPrinter {
  ip: string;
  port: number;
  type: PrinterType;
}

export interface PreheatStatus {
  status: PrinterStatusType | "unknown";
}

export interface PreheatPreset {
  id: PreheatPresetId;
  label: string;
  nozzle_temp: number;
  bed_temp: number;
  profile_id: string | null;
  enabled: boolean;
  reason: string | null;
}

export class PreheatError extends Error {
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
    this.name = "PreheatError";
    this.code = input.code;
    this.status = input.status ?? 400;
    this.retryable = input.retryable ?? false;
    this.details = input.details;
  }
}

function disabledReason(status: PreheatStatus): string | null {
  if (status.status === "idle" || status.status === "paused") return null;
  if (status.status === "printing") return "Unavailable while printing.";
  if (status.status === "offline") return "Printer is offline.";
  if (status.status === "error") return "Clear the printer fault first.";
  return "Printer is not in a compatible state.";
}

export function listPreheatPresets(
  profiles: MaterialProfile[],
  printerType: PrinterType,
  status: PreheatStatus,
): PreheatPreset[] {
  const reason = disabledReason(status);
  const materialPresets = filterMaterialProfilesForPrinterType(
    profiles,
    printerType,
  ).map((profile) => ({
    id: `profile:${profile.id}` as const,
    label: profile.name,
    nozzle_temp: Number(profile.nozzle_temp),
    bed_temp: Number(profile.bed_temp),
    profile_id: profile.id,
    enabled: reason === null,
    reason,
  }));

  return [
    ...materialPresets,
    {
      id: "cooldown",
      label: "Cooldown",
      nozzle_temp: 0,
      bed_temp: 0,
      profile_id: null,
      enabled: reason === null,
      reason,
    },
  ];
}

export async function runPreheatPreset(
  printer: PreheatPrinter,
  status: PreheatStatus,
  profiles: MaterialProfile[],
  presetId: string,
): Promise<PreheatPreset> {
  const preset = listPreheatPresets(profiles, printer.type, status).find(
    (candidate) => candidate.id === presetId,
  );

  if (!preset) {
    throw new PreheatError({
      code: "PREHEAT_PRESET_NOT_FOUND",
      message: "Preheat preset not found.",
      status: 404,
      details: { preset_id: presetId },
    });
  }

  if (!preset.enabled) {
    throw new PreheatError({
      code: "PREHEAT_UNAVAILABLE",
      message: preset.reason ?? "Preheat preset is unavailable.",
      status: 409,
      details: { preset_id: presetId, printer_status: status.status },
    });
  }

  await runGcodeScript(
    printer.ip,
    printer.port,
    `M104 S${preset.nozzle_temp}\nM140 S${preset.bed_temp}`,
  );
  return preset;
}
