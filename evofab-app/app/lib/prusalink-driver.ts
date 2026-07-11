import {
  offlinePrinterStatus,
  type PrinterCommandResult,
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
  id?: number | string;
  state?: string;
  progress?: number;
  file?: { display_name?: string; name?: string };
  time_remaining?: number;
}

interface PrusaStorageResponse {
  storage_list?: Array<{ path?: string; name?: string; available?: boolean }>;
  storage?: Array<{ path?: string; name?: string; available?: boolean }>;
}

export interface PrusaObservedJob {
  id: string;
  state: string | null;
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

  private async connection(printer: Printer) {
    const host = printer.prusalink_host?.trim();
    const keyFile =
      printer.prusalink_key_file?.trim() ?? process.env.PRUSALINK_KEY_FILE;
    if (!host || !keyFile) throw new PrusaLinkClientError("PRUSALINK_CONFIG");
    const key = await (this.options.readKey ?? readPrusaLinkKey)(keyFile);
    return {
      host,
      key,
      timeoutMs: this.options.timeoutMs,
      fetchImpl: this.options.fetchImpl,
    };
  }

  async discoverStorage(printer: Printer): Promise<string> {
    const response = await requestPrusaLink<PrusaStorageResponse>({
      ...(await this.connection(printer)),
      path: "/api/v1/storage",
    });
    const entries = response.data?.storage_list ?? response.data?.storage ?? [];
    const storage =
      entries.find((entry) => entry.available !== false) ?? entries[0];
    const path = storage?.path ?? storage?.name;
    if (!path) throw new PrusaLinkClientError("PRUSALINK_MALFORMED_RESPONSE");
    return path.replace(/^\/+|\/+$/g, "");
  }

  private filePath(storage: string, filename: string): string {
    const safeName = filename.split(/[\\/]/).pop()?.trim();
    if (!safeName) throw new PrusaLinkClientError("PRUSALINK_CONFIG");
    return `/api/v1/files/${encodeURIComponent(storage)}/${encodeURIComponent(safeName)}`;
  }

  async uploadFile(
    printer: Printer,
    storage: string,
    file: File,
  ): Promise<PrinterCommandResult> {
    return this.command(
      async () =>
        requestPrusaLink({
          ...(await this.connection(printer)),
          path: this.filePath(storage, file.name),
          method: "PUT",
          body: file,
          headers: {
            "Content-Type": "application/octet-stream",
            "Content-Length": String(file.size),
            "Print-After-Upload": "?0",
            Overwrite: "?0",
          },
          expectedStatuses: [201],
          parseJson: false,
        }),
      false,
    );
  }

  async verifyStoredFile(
    printer: Printer,
    storage: string,
    filename: string,
  ): Promise<PrinterCommandResult> {
    return this.command(
      async () =>
        requestPrusaLink({
          ...(await this.connection(printer)),
          path: this.filePath(storage, filename),
          expectedStatuses: [200],
          parseJson: false,
        }),
      true,
    );
  }

  async startPrint(
    printer: Printer,
    storage: string,
    filename: string,
  ): Promise<PrinterCommandResult> {
    return this.command(
      async () =>
        requestPrusaLink({
          ...(await this.connection(printer)),
          path: this.filePath(storage, filename),
          method: "POST",
          expectedStatuses: [204],
          parseJson: false,
        }),
      false,
    );
  }

  async observeJob(printer: Printer): Promise<PrusaObservedJob | null> {
    const response = await requestPrusaLink<PrusaJobResponse>({
      ...(await this.connection(printer)),
      path: "/api/v1/job",
    });
    if (!response.data) return null;
    if (response.data.id == null)
      throw new PrusaLinkClientError("PRUSALINK_MALFORMED_RESPONSE");
    return { id: String(response.data.id), state: response.data.state ?? null };
  }

  async pause(printer: Printer, jobId: string) {
    return this.jobCommand(printer, jobId, "pause", "PUT");
  }
  async resume(printer: Printer, jobId: string) {
    return this.jobCommand(printer, jobId, "resume", "PUT");
  }
  async cancel(printer: Printer, jobId: string) {
    return this.jobCommand(printer, jobId, "", "DELETE");
  }

  private async jobCommand(
    printer: Printer,
    jobId: string,
    suffix: string,
    method: "PUT" | "DELETE",
  ) {
    const tail = suffix ? `/${suffix}` : "";
    return this.command(
      async () =>
        requestPrusaLink({
          ...(await this.connection(printer)),
          path: `/api/v1/job/${encodeURIComponent(jobId)}${tail}`,
          method,
          expectedStatuses: [204],
          parseJson: false,
        }),
      false,
    );
  }

  private async command(
    run: () => Promise<unknown>,
    idempotent: boolean,
  ): Promise<PrinterCommandResult> {
    try {
      const response = (await run()) as { status?: number };
      return {
        outcome: "succeeded",
        status: response.status ?? null,
        retryable: false,
      };
    } catch (error) {
      const code =
        error instanceof PrusaLinkClientError
          ? error.category
          : "PRUSALINK_NETWORK";
      const unknown = code === "PRUSALINK_TIMEOUT" && !idempotent;
      const status =
        error instanceof PrusaLinkClientError ? error.status : null;
      return {
        outcome: unknown ? "outcome_unknown" : "failed",
        status,
        retryable:
          idempotent &&
          ["PRUSALINK_NETWORK", "PRUSALINK_TIMEOUT"].includes(code),
        code,
      };
    }
  }
}
