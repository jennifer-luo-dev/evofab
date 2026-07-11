import {
  offlinePrinterStatus,
  type PrinterDriver,
} from "@/app/lib/printer-driver";
import {
  PrusaLinkClientError,
  readPrusaLinkKey,
  requestPrusaLink,
} from "@/app/lib/prusalink-client";
import type {
  Printer,
  PrinterStatus,
  PrinterStatusType,
} from "@/app/types/printer";

interface PrusaStatusResponse {
  printer?: {
    state?: string;
    temp_nozzle?: number;
    temp_bed?: number;
    target_nozzle?: number;
    target_bed?: number;
  };
  temp?: {
    nozzle?: number;
    bed?: number;
    target_nozzle?: number;
    target_bed?: number;
  };
}

interface PrusaJobResponse {
  state?: string;
  progress?: number;
  file?: { display_name?: string; name?: string };
  time_remaining?: number;
}

const STATE_MAP: Record<string, PrinterStatusType> = {
  idle: "idle",
  ready: "idle",
  operational: "idle",
  printing: "printing",
  paused: "paused",
  error: "error",
  attention: "error",
};

export function normalizePrusaLinkStatus(
  printerId: string,
  status: PrusaStatusResponse,
  job: PrusaJobResponse | null,
  now = new Date(),
): PrinterStatus {
  const rawState = job?.state ?? status.printer?.state;
  if (!rawState) throw new PrusaLinkClientError("PRUSALINK_MALFORMED_RESPONSE");
  const normalizedState = rawState.toLowerCase();
  const progress = Math.max(0, Math.min(100, Number(job?.progress ?? 0)));
  return {
    printer_id: printerId,
    online: true,
    status: STATE_MAP[normalizedState] ?? "idle",
    print_state: rawState,
    filename: job?.file?.display_name ?? job?.file?.name ?? null,
    progress: Number.isFinite(progress) ? progress : 0,
    layer_current: null,
    layer_total: null,
    hotend_temp: status.printer?.temp_nozzle ?? status.temp?.nozzle ?? null,
    hotend_target:
      status.printer?.target_nozzle ?? status.temp?.target_nozzle ?? null,
    bed_temp: status.printer?.temp_bed ?? status.temp?.bed ?? null,
    bed_target: status.printer?.target_bed ?? status.temp?.target_bed ?? null,
    eta_seconds: job?.time_remaining ?? null,
    progress_source: job ? "exact" : "unknown",
    layer_source: "unknown",
    fault_message: null,
    fault_mcu: null,
    updated_at: now.toISOString(),
  };
}

export class PrusaLinkDriver implements PrinterDriver {
  constructor(
    private readonly options: {
      timeoutMs?: number;
      fetchImpl?: typeof fetch;
      readKey?: typeof readPrusaLinkKey;
    } = {},
  ) {}

  async readStatus(printer: Printer): Promise<PrinterStatus> {
    try {
      const host = printer.prusalink_host?.trim();
      const keyFile =
        printer.prusalink_key_file?.trim() ?? process.env.PRUSALINK_KEY_FILE;
      if (!host || !keyFile) throw new PrusaLinkClientError("PRUSALINK_CONFIG");
      const key = await (this.options.readKey ?? readPrusaLinkKey)(keyFile);
      const common = {
        host,
        key,
        timeoutMs: this.options.timeoutMs,
        fetchImpl: this.options.fetchImpl,
      };
      const status = await requestPrusaLink<PrusaStatusResponse>({
        ...common,
        path: "/api/v1/status",
      });
      const job = await requestPrusaLink<PrusaJobResponse>({
        ...common,
        path: "/api/v1/job",
      });
      if (!status.data)
        throw new PrusaLinkClientError("PRUSALINK_MALFORMED_RESPONSE");
      return normalizePrusaLinkStatus(printer.id, status.data, job.data);
    } catch (error) {
      const category =
        error instanceof PrusaLinkClientError
          ? error.category
          : "PRUSALINK_NETWORK";
      return offlinePrinterStatus(printer.id, category);
    }
  }
}
