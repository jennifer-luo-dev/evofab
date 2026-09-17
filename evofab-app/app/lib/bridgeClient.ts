// bridgeClient.ts
// Shared helpers for this directory's small hardware-bridge HTTP clients
// (arduino.ts, camera.ts, classification.ts, moonraker.ts, robot.ts) — each
// talks to a different bridge process (a FastAPI server or Moonraker)
// identified by a machine's ip/port, and each threw the same
// "descriptive Error on a non-2xx response" shape independently before this
// module existed. Extracting it here is a pure de-duplication: every call
// site's request and thrown-error text are unchanged.

/** Builds the `http://ip:port` base URL for a hardware bridge. */
export function bridgeBase(ip: string, port: number): string {
  return `http://${ip}:${port}`
}

/**
 * Throws a descriptive Error if `res` is not ok, reading the response body
 * as the error detail.
 * @param res - The fetch Response to check.
 * @param label - Leading phrase of the thrown message, e.g. "Robot move" produces "Robot move failed (500): <body>".
 */
export async function throwIfNotOk(res: Response, label: string): Promise<void> {
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`${label} failed (${res.status}): ${text}`)
  }
}
