// machineRouting.ts
// Shared helpers for the Next.js API routes that front a hardware bridge
// (actuate, camera-capture, classify, print, print/pause, robot-move,
// robot-stop) — each of them independently looked up a `machines` row's
// ip/port (404-ing the same way if missing) and try/caught its bridge call
// into a 502 with the same `err instanceof Error ? err.message : String(err)`
// shape. Extracting both here is a pure de-duplication: every route's exact
// status codes and JSON error shape are unchanged (see REFACTOR_PLAN.md
// Phase C).

import { NextResponse } from 'next/server'
import type { createClient } from '@/app/lib/supabase-server'

export interface MachineIpPort {
  ip: string
  port: number
}

/**
 * Looks up a machine's `ip`/`port` from Supabase, falling back to
 * `defaultPort` when the row has none set.
 * @param supabase - A server Supabase client (from createClient()).
 * @param machineId - The `machines.id` to look up.
 * @param notFoundMessage - Error text for the 404 response if the machine is missing or has no ip.
 * @param defaultPort - Port to use when the row's `port` column is null.
 * @returns The resolved `{ ip, port }`, or a ready-to-return 404 NextResponse — callers should
 *          `return` it directly when it's a NextResponse rather than treat it as data.
 */
export async function resolveMachine(
  supabase: Awaited<ReturnType<typeof createClient>>,
  machineId: string,
  notFoundMessage: string,
  defaultPort: number
): Promise<MachineIpPort | NextResponse> {
  const { data: machine, error } = await supabase
    .from('machines')
    .select('ip, port')
    .eq('id', machineId)
    .single()

  if (error || !machine?.ip) {
    return NextResponse.json({ error: notFoundMessage }, { status: 404 })
  }
  return { ip: machine.ip, port: machine.port ?? defaultPort }
}

/**
 * Runs `fn` (a hardware-bridge call) and maps a thrown error to a 502
 * NextResponse with the same `{ error: message }` shape every bridge-calling
 * route already used.
 * @param fn - The bridge call to run.
 * @returns `fn`'s resolved value, or a ready-to-return 502 NextResponse — callers should
 *          `return` it directly when it's a NextResponse rather than treat it as data.
 */
export async function callBridge<T>(fn: () => Promise<T>): Promise<T | NextResponse> {
  try {
    return await fn()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
