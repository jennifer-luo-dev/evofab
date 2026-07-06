import { MoonrakerError } from './moonraker-errors'

export type MoonrakerMode = 'mock' | 'local' | 'hardware'

export const HARDWARE_CONFIRMATION = 'I_UNDERSTAND_THIS_CONTROLS_PHYSICAL_HARDWARE'

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

export function getMoonrakerMode(env: NodeJS.ProcessEnv = process.env): MoonrakerMode {
  const mode = env.MOONRAKER_MODE
  return mode === 'local' || mode === 'hardware' || mode === 'mock' ? mode : 'mock'
}

function assertLoopback(url: URL, printerId: string) {
  if (!LOOPBACK_HOSTS.has(url.hostname)) {
    throw new MoonrakerError({
      code: 'UNSAFE_MOCK_URL',
      message: 'Mock mode may connect only to a loopback Moonraker simulator.',
      printerId,
      retryable: false,
      details: url.origin,
    })
  }
}

export function resolveMoonrakerBaseUrl({
  printerId,
  ip,
  port,
  mockBaseUrl,
  env = process.env,
}: {
  printerId: string
  ip?: string
  port?: number
  mockBaseUrl?: string
  env?: NodeJS.ProcessEnv
}): string {
  const mode = getMoonrakerMode(env)

  if (mode === 'mock') {
    const url = new URL(mockBaseUrl ?? env.MOCK_MOONRAKER_URL ?? 'http://127.0.0.1:7125')
    assertLoopback(url, printerId)
    return url.origin
  }

  if (mode === 'local') {
    throw new MoonrakerError({
      code: 'MOONRAKER_DISABLED',
      message: 'Moonraker calls are disabled in local mode. Use mock mode for simulation.',
      printerId,
      retryable: false,
    })
  }

  if (env.HARDWARE_CONFIRMATION !== HARDWARE_CONFIRMATION) {
    throw new MoonrakerError({
      code: 'HARDWARE_CONFIRMATION_REQUIRED',
      message: 'Hardware mode requires explicit physical-hardware confirmation.',
      printerId,
      retryable: false,
    })
  }

  if (!ip || !port) {
    throw new MoonrakerError({
      code: 'MOONRAKER_DISABLED',
      message: 'This printer has no configured Moonraker address.',
      printerId,
      retryable: false,
    })
  }

  return `http://${ip}:${port}`
}
