export type MoonrakerErrorCode =
  | 'HARDWARE_CONFIRMATION_REQUIRED'
  | 'MOONRAKER_DISABLED'
  | 'MOONRAKER_MALFORMED_RESPONSE'
  | 'MOONRAKER_OFFLINE'
  | 'MOONRAKER_REJECTED'
  | 'MOONRAKER_TIMEOUT'
  | 'UNSAFE_MOCK_URL'

interface MoonrakerErrorOptions {
  code: MoonrakerErrorCode
  message: string
  printerId: string
  retryable: boolean
  details?: string
}

export class MoonrakerError extends Error {
  readonly code: MoonrakerErrorCode
  readonly printerId: string
  readonly retryable: boolean
  readonly details?: string

  constructor({ code, message, printerId, retryable, details }: MoonrakerErrorOptions) {
    super(message)
    this.name = 'MoonrakerError'
    this.code = code
    this.printerId = printerId
    this.retryable = retryable
    this.details = details
  }
}

export function normalizeMoonrakerError(error: unknown, printerId: string): MoonrakerError {
  if (error instanceof MoonrakerError) return error

  if (error instanceof DOMException && error.name === 'TimeoutError') {
    return new MoonrakerError({
      code: 'MOONRAKER_TIMEOUT',
      message: 'Moonraker request timed out.',
      printerId,
      retryable: true,
      details: error.message,
    })
  }

  if (error instanceof Error && error.name === 'AbortError') {
    return new MoonrakerError({
      code: 'MOONRAKER_TIMEOUT',
      message: 'Moonraker request timed out.',
      printerId,
      retryable: true,
      details: error.message,
    })
  }

  return new MoonrakerError({
    code: 'MOONRAKER_OFFLINE',
    message: 'Moonraker is unavailable.',
    printerId,
    retryable: true,
    details: error instanceof Error ? error.message : String(error),
  })
}
