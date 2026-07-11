import type {
  Printer,
  PrinterStatus,
  PrinterStatusType,
} from "@/app/types/printer";
import { resolveMoonrakerBaseUrl } from "./moonraker-config";
import { MoonrakerError, normalizeMoonrakerError } from "./moonraker-errors";
import type { PrinterDriver } from "./printer-driver";
export type PrinterStatusConnector = PrinterDriver;

export interface MoonrakerServerInfo {
  moonrakerVersion: string;
  klipperVersion: string | null;
  klippyState: string | null;
}

interface MoonrakerStatusResponse {
  result?: {
    status?: {
      webhooks?: {
        state?: string;
        state_message?: string;
      };
      print_stats?: {
        state?: string;
        filename?: string;
        message?: string;
        print_duration?: number;
        info?: {
          current_layer?: number | null;
          total_layer?: number | null;
        };
      };
      virtual_sdcard?: {
        progress?: number;
      };
      extruder?: {
        temperature?: number;
        target?: number;
      };
      heater_bed?: {
        temperature?: number;
        target?: number;
      };
    };
  };
}

interface MoonrakerServerInfoResponse {
  result?: {
    moonraker_version?: string;
    klipper_version?: string;
    klippy_version?: string;
    software_version?: string;
    klippy_state?: string;
  };
}

const STATUS_QUERY =
  "/printer/objects/query?webhooks&print_stats&extruder&heater_bed&virtual_sdcard";
const SERVER_INFO_PATH = "/server/info";

const STATE_MAP: Record<string, PrinterStatusType> = {
  standby: "idle",
  complete: "idle",
  cancelled: "idle",
  printing: "printing",
  paused: "paused",
  error: "error",
};

function statusFromRawState(
  rawState: string,
  webhookState?: string,
): PrinterStatusType {
  if (webhookState === "shutdown") return "error";
  return STATE_MAP[rawState] ?? "idle";
}

function progressToPercent(progress: number | undefined): number {
  if (typeof progress !== "number" || !Number.isFinite(progress)) return 0;
  const percent = progress <= 1 ? progress * 100 : progress;
  return Math.max(0, Math.min(100, percent));
}

function estimateLayer(
  progressPercent: number,
  totalLayer: number | null,
): number | null {
  if (!totalLayer || totalLayer <= 0 || progressPercent <= 0) return null;
  return Math.max(
    1,
    Math.min(totalLayer, Math.ceil((progressPercent / 100) * totalLayer)),
  );
}

function estimateEtaSeconds(
  progressPercent: number,
  printDuration: number | undefined,
): number | null {
  if (
    typeof printDuration !== "number" ||
    !Number.isFinite(printDuration) ||
    printDuration <= 0 ||
    progressPercent <= 0 ||
    progressPercent >= 100
  ) {
    return null;
  }

  return Math.max(
    0,
    Math.round((printDuration * (100 - progressPercent)) / progressPercent),
  );
}

function faultMcuFromMessage(message: string | undefined): string | null {
  if (!message) return null;
  const quoted = message.match(/MCU ['"]([^'"]+)['"]/i);
  return quoted?.[1] ?? null;
}

export function normalizeMoonrakerStatus(
  printerId: string,
  response: MoonrakerStatusResponse,
  now = new Date(),
): PrinterStatus {
  const status = response.result?.status;

  if (!status) {
    throw new MoonrakerError({
      code: "MOONRAKER_MALFORMED_RESPONSE",
      message: "Moonraker returned no printer status.",
      printerId,
      retryable: true,
    });
  }

  const printStats = status.print_stats ?? {};
  const webhooks = status.webhooks ?? {};
  const rawState = printStats.state ?? webhooks.state ?? "standby";
  const virtualSd = status.virtual_sdcard ?? {};
  const extruder = status.extruder ?? {};
  const bed = status.heater_bed ?? {};
  const progress = progressToPercent(virtualSd.progress);
  const exactCurrentLayer = printStats.info?.current_layer ?? null;
  const exactTotalLayer = printStats.info?.total_layer ?? null;
  const estimatedTotalLayer =
    progress > 0 && exactTotalLayer === null ? 100 : exactTotalLayer;
  const layerCurrent =
    exactCurrentLayer ?? estimateLayer(progress, estimatedTotalLayer);
  const layerSource =
    exactCurrentLayer !== null && exactTotalLayer !== null
      ? "exact"
      : layerCurrent !== null
        ? "estimated"
        : "unknown";
  const faultMessage =
    webhooks.state === "shutdown" || rawState === "error"
      ? (printStats.message ?? webhooks.state_message ?? null)
      : null;

  return {
    printer_id: printerId,
    online: true,
    status: statusFromRawState(rawState, webhooks.state),
    print_state: rawState,
    filename: printStats.filename || null,
    progress,
    layer_current: layerCurrent,
    layer_total: estimatedTotalLayer,
    hotend_temp: extruder.temperature ?? null,
    hotend_target: extruder.target ?? null,
    bed_temp: bed.temperature ?? null,
    bed_target: bed.target ?? null,
    eta_seconds: estimateEtaSeconds(progress, printStats.print_duration),
    progress_source:
      typeof virtualSd.progress === "number" ? "estimated" : "unknown",
    layer_source: layerSource,
    fault_message: faultMessage,
    fault_mcu: faultMcuFromMessage(faultMessage ?? undefined),
    updated_at: now.toISOString(),
  };
}

export function normalizeMoonrakerServerInfo(
  printerId: string,
  response: MoonrakerServerInfoResponse,
): MoonrakerServerInfo {
  const result = response.result;

  if (!result || typeof result.moonraker_version !== "string") {
    throw new MoonrakerError({
      code: "MOONRAKER_MALFORMED_RESPONSE",
      message: "Moonraker returned no server version.",
      printerId,
      retryable: true,
    });
  }

  const klipperVersion =
    result.klipper_version ??
    result.klippy_version ??
    result.software_version ??
    null;

  return {
    moonrakerVersion: result.moonraker_version,
    klipperVersion,
    klippyState: result.klippy_state ?? null,
  };
}

export class MoonrakerStatusConnector implements PrinterDriver {
  private readonly timeoutMs: number;
  private readonly mockBaseUrl?: string;

  constructor(options: { timeoutMs?: number; mockBaseUrl?: string } = {}) {
    this.timeoutMs =
      options.timeoutMs ?? Number(process.env.MOONRAKER_TIMEOUT_MS ?? 3_000);
    this.mockBaseUrl = options.mockBaseUrl;
  }

  async readStatus(printer: Printer): Promise<PrinterStatus> {
    const baseUrl = resolveMoonrakerBaseUrl({
      printerId: printer.id,
      ip: printer.ip,
      port: printer.port,
      mockBaseUrl: this.mockBaseUrl,
    });

    try {
      const response = await fetch(`${baseUrl}${STATUS_QUERY}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      const text = await response.text();

      if (!response.ok) {
        throw new MoonrakerError({
          code:
            response.status >= 500 ? "MOONRAKER_OFFLINE" : "MOONRAKER_REJECTED",
          message:
            response.status >= 500
              ? "Moonraker is unavailable."
              : "Moonraker rejected the status request.",
          printerId: printer.id,
          retryable: response.status >= 500,
          details: `HTTP ${response.status}: ${text.slice(0, 500)}`,
        });
      }

      try {
        return normalizeMoonrakerStatus(
          printer.id,
          (text ? JSON.parse(text) : null) as MoonrakerStatusResponse,
        );
      } catch (error) {
        if (error instanceof MoonrakerError) throw error;
        throw new MoonrakerError({
          code: "MOONRAKER_MALFORMED_RESPONSE",
          message: "Moonraker returned an unreadable status response.",
          printerId: printer.id,
          retryable: true,
          details: text.slice(0, 500),
        });
      }
    } catch (error) {
      throw normalizeMoonrakerError(error, printer.id);
    }
  }

  async readServerInfo(printer: Printer): Promise<MoonrakerServerInfo> {
    const baseUrl = resolveMoonrakerBaseUrl({
      printerId: printer.id,
      ip: printer.ip,
      port: printer.port,
      mockBaseUrl: this.mockBaseUrl,
    });

    try {
      const response = await fetch(`${baseUrl}${SERVER_INFO_PATH}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      const text = await response.text();

      if (!response.ok) {
        throw new MoonrakerError({
          code:
            response.status >= 500 ? "MOONRAKER_OFFLINE" : "MOONRAKER_REJECTED",
          message:
            response.status >= 500
              ? "Moonraker is unavailable."
              : "Moonraker rejected the server info request.",
          printerId: printer.id,
          retryable: response.status >= 500,
          details: `HTTP ${response.status}: ${text.slice(0, 500)}`,
        });
      }

      try {
        return normalizeMoonrakerServerInfo(
          printer.id,
          (text ? JSON.parse(text) : null) as MoonrakerServerInfoResponse,
        );
      } catch (error) {
        if (error instanceof MoonrakerError) throw error;
        throw new MoonrakerError({
          code: "MOONRAKER_MALFORMED_RESPONSE",
          message: "Moonraker returned an unreadable server info response.",
          printerId: printer.id,
          retryable: true,
          details: text.slice(0, 500),
        });
      }
    } catch (error) {
      throw normalizeMoonrakerError(error, printer.id);
    }
  }
}
