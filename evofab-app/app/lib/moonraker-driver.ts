import { createHash } from "node:crypto";
import { MoonrakerStatusConnector } from "@/app/lib/moonraker-client";
import { resolveMoonrakerBaseUrl } from "@/app/lib/moonraker-config";
import {
  MoonrakerError,
  normalizeMoonrakerError,
} from "@/app/lib/moonraker-errors";
import type {
  PrinterCommandResult,
  PrinterDriverErrorCategory,
  PrinterFileDriver,
  PrinterUploadResult,
} from "@/app/lib/printer-driver";
import type { Printer } from "@/app/types/printer";

type MoonrakerFileList = { result?: Array<{ path?: string }> };
type MoonrakerUploadResponse = {
  item?: { path?: string };
  print_started?: boolean;
  print_queued?: boolean;
};

function codeFor(error: unknown): PrinterDriverErrorCategory {
  if (error instanceof MoonrakerError) {
    if (error.code === "MOONRAKER_TIMEOUT") return "MOONRAKER_TIMEOUT";
    if (error.code === "MOONRAKER_REJECTED") return "MOONRAKER_REJECTED";
    if (error.code === "MOONRAKER_MALFORMED_RESPONSE")
      return "MOONRAKER_MALFORMED_RESPONSE";
  }
  return "MOONRAKER_NETWORK";
}

export class MoonrakerDriver
  extends MoonrakerStatusConnector
  implements PrinterFileDriver
{
  readonly capabilities = new Set([
    "upload_file",
    "verify_file",
    "start_print",
  ] as const);

  constructor(
    private readonly options: {
      timeoutMs?: number;
      fetchImpl?: typeof fetch;
      env?: NodeJS.ProcessEnv;
    } = {},
  ) {
    super({ timeoutMs: options.timeoutMs });
  }

  private base(printer: Printer): string {
    return resolveMoonrakerBaseUrl({
      printerId: printer.id,
      ip: printer.moonraker_host ?? printer.ip,
      port: printer.moonraker_port ?? printer.port,
      env: this.options.env,
    });
  }

  private async request(
    printer: Printer,
    path: string,
    init: RequestInit,
  ): Promise<Response> {
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const timeoutMs = this.options.timeoutMs ?? 5_000;
    try {
      return await fetchImpl(`${this.base(printer)}${path}`, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw normalizeMoonrakerError(error, printer.id);
    }
  }

  async uploadFile(
    printer: Printer,
    file: File,
    path: string,
  ): Promise<PrinterUploadResult> {
    try {
      const checksum = createHash("sha256")
        .update(Buffer.from(await file.arrayBuffer()))
        .digest("hex");
      const form = new FormData();
      form.append("file", file, file.name);
      form.append("root", "gcodes");
      form.append("path", path);
      form.append("checksum", checksum);
      form.append("print", "false");
      const response = await this.request(printer, "/server/files/upload", {
        method: "POST",
        body: form,
      });
      const body = (await response
        .json()
        .catch(() => null)) as MoonrakerUploadResponse | null;
      if (response.status === 422) {
        return {
          outcome: "failed",
          status: 422,
          retryable: false,
          code: "MOONRAKER_CHECKSUM_MISMATCH",
        };
      }
      const storedPath = body?.item?.path;
      if (
        !response.ok ||
        !storedPath ||
        body.print_started ||
        body.print_queued
      ) {
        return {
          outcome: "failed",
          status: response.status,
          retryable: false,
          code: !storedPath
            ? "MOONRAKER_MALFORMED_RESPONSE"
            : "MOONRAKER_REJECTED",
        };
      }
      return {
        outcome: "succeeded",
        status: response.status,
        retryable: false,
        path: storedPath,
      };
    } catch (error) {
      const code = codeFor(error);
      return {
        outcome: code === "MOONRAKER_TIMEOUT" ? "outcome_unknown" : "failed",
        status: null,
        retryable: false,
        code,
      };
    }
  }

  async verifyStoredFile(
    printer: Printer,
    path: string,
  ): Promise<PrinterCommandResult> {
    try {
      const response = await this.request(
        printer,
        "/server/files/list?root=gcodes",
        {
          cache: "no-store",
        },
      );
      const body = (await response
        .json()
        .catch(() => null)) as MoonrakerFileList | null;
      if (!response.ok) {
        return {
          outcome: "failed",
          status: response.status,
          retryable: false,
          code: "MOONRAKER_REJECTED",
        };
      }
      const found = body?.result?.some((item) => item.path === path);
      return found
        ? { outcome: "succeeded", status: response.status, retryable: false }
        : {
            outcome: "failed",
            status: response.status,
            retryable: false,
            code: "MOONRAKER_NOT_FOUND",
          };
    } catch (error) {
      const code = codeFor(error);
      return {
        outcome: code === "MOONRAKER_TIMEOUT" ? "outcome_unknown" : "failed",
        status: null,
        retryable: false,
        code,
      };
    }
  }
}
