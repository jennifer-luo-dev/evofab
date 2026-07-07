import type { PrintSettings } from "@/app/types/job";

export const PREPARED_PRINT_STORAGE_PREFIX = "evofab:prepared-print:";

export interface PreparedPrintDraft {
  id: string;
  filename: string;
  displayName?: string;
  gcode: string;
  materialProfileId: string | null;
  settings: PrintSettings;
  prepareSettings: {
    supports: boolean;
    rotation: number[] | null;
    orientation: "custom" | "uploaded";
  };
  experimentParams: Record<string, unknown>;
  createdAt: string;
}

export function preparedPrintStorageKey(id: string): string {
  return `${PREPARED_PRINT_STORAGE_PREFIX}${id}`;
}

export function createPreparedPrintId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
