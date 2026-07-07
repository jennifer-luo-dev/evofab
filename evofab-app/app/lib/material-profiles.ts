import type { MaterialProfile, PrintSettings } from "@/app/types/job";
import type { PrinterType } from "@/app/types/printer";

export const EMPTY_PRINT_SETTINGS: PrintSettings = {
  nozzle_temp: 0,
  bed_temp: 0,
  speed: 0,
  flow_rate: 0,
  fan_speed: 0,
};

export function settingsFromMaterialProfile(
  profile: MaterialProfile,
): PrintSettings {
  return {
    nozzle_temp: Number(profile.nozzle_temp),
    bed_temp: Number(profile.bed_temp),
    speed: Number(profile.speed),
    flow_rate: Number(profile.flow_rate),
    fan_speed: Number(profile.fan_speed),
  };
}

export function profileSupportsPrinterType(
  profile: Pick<MaterialProfile, "printer_type">,
  printerType: PrinterType,
): boolean {
  return (
    profile.printer_type === "BOTH" || profile.printer_type === printerType
  );
}

export function filterMaterialProfilesForPrinterType(
  profiles: MaterialProfile[],
  printerType: PrinterType | null | undefined,
): MaterialProfile[] {
  if (!printerType) return profiles;
  return profiles.filter((profile) =>
    profileSupportsPrinterType(profile, printerType),
  );
}

export function normalizePrintSettings(input: unknown): Partial<PrintSettings> {
  if (!input || typeof input !== "object") return {};
  const values = input as Record<string, unknown>;
  const next: Partial<PrintSettings> = {};

  for (const key of [
    "nozzle_temp",
    "bed_temp",
    "speed",
    "flow_rate",
    "fan_speed",
  ] as const) {
    const value = Number(values[key]);
    if (Number.isFinite(value)) next[key] = value;
  }

  return next;
}

export function mergePrintSettings(
  base: PrintSettings,
  overrides: Partial<PrintSettings>,
): PrintSettings {
  return {
    nozzle_temp: overrides.nozzle_temp ?? base.nozzle_temp,
    bed_temp: overrides.bed_temp ?? base.bed_temp,
    speed: overrides.speed ?? base.speed,
    flow_rate: overrides.flow_rate ?? base.flow_rate,
    fan_speed: overrides.fan_speed ?? base.fan_speed,
  };
}
