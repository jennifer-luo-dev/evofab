import type { PrintSettings } from "@/app/types/job";
import type { PrinterStatus, PrinterStatusType } from "@/app/types/printer";
import { resolveMoonrakerBaseUrl } from "./config";
import { MoonrakerError, normalizeMoonrakerError } from "./errors";

interface ClientOptions {
  printerId: string;
  ip?: string;
  port?: number;
  mockBaseUrl?: string;
  timeoutMs?: number;
}

interface StatusResponse {
  result?: {
    status?: {
      webhooks?: { state?: string; state_message?: string };
      print_stats?: {
        state?: string;
        filename?: string;
        message?: string;
        info?: { current_layer?: number | null; total_layer?: number | null };
      };
      virtual_sdcard?: { progress?: number };
      extruder?: { temperature?: number; target?: number };
      heater_bed?: { temperature?: number; target?: number };
    };
  };
}

const STATE_MAP: Record<string, PrinterStatusType> = {
  standby: "idle",
  printing: "printing",
  paused: "paused",
  error: "error",
  complete: "idle",
  cancelled: "idle",
};

export class MoonrakerClient {
  readonly printerId: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(options: ClientOptions) {
    this.printerId = options.printerId;
    this.baseUrl = resolveMoonrakerBaseUrl(options);
    this.timeoutMs =
      options.timeoutMs ?? Number(process.env.MOONRAKER_TIMEOUT_MS ?? 3000);
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
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
              : "Moonraker rejected the printer command.",
          retryable: response.status >= 500,
          printerId: this.printerId,
          details: `HTTP ${response.status}: ${text.slice(0, 500)}`,
        });
      }

      try {
        return (text ? JSON.parse(text) : null) as T;
      } catch {
        throw new MoonrakerError({
          code: "MOONRAKER_MALFORMED_RESPONSE",
          message: "Moonraker returned an unreadable response.",
          retryable: true,
          printerId: this.printerId,
          details: text.slice(0, 500),
        });
      }
    } catch (error) {
      throw normalizeMoonrakerError(error, this.printerId);
    }
  }

  async getStatus(): Promise<PrinterStatus> {
    const json = await this.request<StatusResponse>(
      "/printer/objects/query?webhooks&print_stats&extruder&heater_bed&virtual_sdcard",
    );
    const status = json.result?.status;
    if (!status) {
      throw new MoonrakerError({
        code: "MOONRAKER_MALFORMED_RESPONSE",
        message: "Moonraker returned no printer status.",
        retryable: true,
        printerId: this.printerId,
      });
    }

    const printStats = status.print_stats ?? {};
    const virtualSd = status.virtual_sdcard ?? {};
    const extruder = status.extruder ?? {};
    const bed = status.heater_bed ?? {};
    const rawState = printStats.state ?? status.webhooks?.state ?? "standby";

    return {
      printer_id: this.printerId,
      online: true,
      status:
        STATE_MAP[rawState] ??
        (status.webhooks?.state === "shutdown" ? "error" : "idle"),
      print_state: rawState,
      filename: printStats.filename || null,
      progress:
        typeof virtualSd.progress === "number" ? virtualSd.progress * 100 : 0,
      layer_current: printStats.info?.current_layer ?? null,
      layer_total: printStats.info?.total_layer ?? null,
      hotend_temp: extruder.temperature ?? null,
      hotend_target: extruder.target ?? null,
      bed_temp: bed.temperature ?? null,
      bed_target: bed.target ?? null,
      eta_seconds: null,
      updated_at: new Date().toISOString(),
    };
  }

  async uploadGcode(file: File): Promise<string> {
    const form = new FormData();
    form.append("file", file, file.name);
    form.append("path", "");
    const json = await this.request<{
      item?: { path?: string };
      result?: { item?: { path?: string } };
    }>("/server/files/upload", { method: "POST", body: form });
    return json.item?.path ?? json.result?.item?.path ?? file.name;
  }

  async applyPrintSettings(settings: PrintSettings): Promise<void> {
    const script = [
      `M104 S${settings.nozzle_temp}`,
      `M140 S${settings.bed_temp}`,
      `SET_VELOCITY_LIMIT VELOCITY=${settings.speed}`,
      `M221 S${Math.round(settings.flow_rate * 100)}`,
      `M106 S${Math.round((settings.fan_speed / 100) * 255)}`,
    ].join("\n");
    await this.runGcode(script);
  }

  async runGcode(script: string): Promise<void> {
    await this.request("/printer/gcode/script", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ script }),
    });
  }

  async startPrint(filename: string): Promise<void> {
    await this.command("/printer/print/start", { filename });
  }

  async pausePrint(): Promise<void> {
    await this.command("/printer/print/pause");
  }
  async resumePrint(): Promise<void> {
    await this.command("/printer/print/resume");
  }
  async cancelPrint(): Promise<void> {
    await this.command("/printer/print/cancel");
  }

  // RR-1: this endpoint interrupts immediately. Never queue M112 through runGcode.
  async emergencyStop(): Promise<void> {
    await this.command("/printer/emergency_stop");
  }
  async restart(): Promise<void> {
    await this.command("/printer/restart");
  }
  async firmwareRestart(): Promise<void> {
    await this.command("/printer/firmware_restart");
  }

  private async command(
    path: string,
    body?: Record<string, unknown>,
  ): Promise<void> {
    await this.request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
  }
}
