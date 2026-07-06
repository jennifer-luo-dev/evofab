import type { Printer, PrinterStatus, PrinterStatusType } from '@/app/types/printer'
import { resolveMoonrakerBaseUrl } from './moonraker-config'
import { MoonrakerError, normalizeMoonrakerError } from './moonraker-errors'

export interface PrinterStatusConnector {
  readStatus(printer: Printer): Promise<PrinterStatus>
}

interface MoonrakerStatusResponse {
  result?: {
    status?: {
      webhooks?: {
        state?: string
        state_message?: string
      }
      print_stats?: {
        state?: string
        filename?: string
        message?: string
        info?: {
          current_layer?: number | null
          total_layer?: number | null
        }
      }
      virtual_sdcard?: {
        progress?: number
      }
      extruder?: {
        temperature?: number
        target?: number
      }
      heater_bed?: {
        temperature?: number
        target?: number
      }
    }
  }
}

const STATUS_QUERY =
  '/printer/objects/query?webhooks&print_stats&extruder&heater_bed&virtual_sdcard'

const STATE_MAP: Record<string, PrinterStatusType> = {
  standby: 'idle',
  complete: 'idle',
  cancelled: 'idle',
  printing: 'printing',
  paused: 'paused',
  error: 'error',
}

function statusFromRawState(rawState: string, webhookState?: string): PrinterStatusType {
  if (webhookState === 'shutdown') return 'error'
  return STATE_MAP[rawState] ?? 'idle'
}

function progressToPercent(progress: number | undefined): number {
  if (typeof progress !== 'number' || !Number.isFinite(progress)) return 0
  const percent = progress <= 1 ? progress * 100 : progress
  return Math.max(0, Math.min(100, percent))
}

export function normalizeMoonrakerStatus(
  printerId: string,
  response: MoonrakerStatusResponse,
  now = new Date()
): PrinterStatus {
  const status = response.result?.status

  if (!status) {
    throw new MoonrakerError({
      code: 'MOONRAKER_MALFORMED_RESPONSE',
      message: 'Moonraker returned no printer status.',
      printerId,
      retryable: true,
    })
  }

  const printStats = status.print_stats ?? {}
  const webhooks = status.webhooks ?? {}
  const rawState = printStats.state ?? webhooks.state ?? 'standby'
  const virtualSd = status.virtual_sdcard ?? {}
  const extruder = status.extruder ?? {}
  const bed = status.heater_bed ?? {}

  return {
    printer_id: printerId,
    online: true,
    status: statusFromRawState(rawState, webhooks.state),
    print_state: rawState,
    filename: printStats.filename || null,
    progress: progressToPercent(virtualSd.progress),
    layer_current: printStats.info?.current_layer ?? null,
    layer_total: printStats.info?.total_layer ?? null,
    hotend_temp: extruder.temperature ?? null,
    hotend_target: extruder.target ?? null,
    bed_temp: bed.temperature ?? null,
    bed_target: bed.target ?? null,
    eta_seconds: null,
    updated_at: now.toISOString(),
  }
}

export class MoonrakerStatusConnector implements PrinterStatusConnector {
  private readonly timeoutMs: number
  private readonly mockBaseUrl?: string

  constructor(options: { timeoutMs?: number; mockBaseUrl?: string } = {}) {
    this.timeoutMs =
      options.timeoutMs ?? Number(process.env.MOONRAKER_TIMEOUT_MS ?? 3_000)
    this.mockBaseUrl = options.mockBaseUrl
  }

  async readStatus(printer: Printer): Promise<PrinterStatus> {
    const baseUrl = resolveMoonrakerBaseUrl({
      printerId: printer.id,
      ip: printer.ip,
      port: printer.port,
      mockBaseUrl: this.mockBaseUrl,
    })

    try {
      const response = await fetch(`${baseUrl}${STATUS_QUERY}`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(this.timeoutMs),
      })
      const text = await response.text()

      if (!response.ok) {
        throw new MoonrakerError({
          code: response.status >= 500 ? 'MOONRAKER_OFFLINE' : 'MOONRAKER_REJECTED',
          message:
            response.status >= 500
              ? 'Moonraker is unavailable.'
              : 'Moonraker rejected the status request.',
          printerId: printer.id,
          retryable: response.status >= 500,
          details: `HTTP ${response.status}: ${text.slice(0, 500)}`,
        })
      }

      try {
        return normalizeMoonrakerStatus(
          printer.id,
          (text ? JSON.parse(text) : null) as MoonrakerStatusResponse
        )
      } catch (error) {
        if (error instanceof MoonrakerError) throw error
        throw new MoonrakerError({
          code: 'MOONRAKER_MALFORMED_RESPONSE',
          message: 'Moonraker returned an unreadable status response.',
          printerId: printer.id,
          retryable: true,
          details: text.slice(0, 500),
        })
      }
    } catch (error) {
      throw normalizeMoonrakerError(error, printer.id)
    }
  }
}
