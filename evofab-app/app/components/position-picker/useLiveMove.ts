// useLiveMove.ts
// Fires an actual robot move (Cartesian or joint-space) for a discrete
// picker interaction (jog press, pad-drag release, slider/dial release,
// Home), mirroring app/robot-test/page.tsx's handleJog — which calls the
// same POST /api/robot-move endpoint on every jog click, not just on a final
// "confirm". Direct-entry typed fields intentionally do NOT go through this
// (robot-test doesn't move-on-type either, only its jog buttons do).

'use client'

import { useCallback, useRef, useState } from 'react'
import type { MoveTargetBody } from '@/app/lib/robot'

export interface UseLiveMoveResult {
  /** No-ops silently if a move is already in flight — callers don't need to guard against overlap themselves. */
  sendMove: (machineId: string, body: MoveTargetBody) => void
  sending: boolean
  error: string | null
}

/** POST /api/robot-move blocks server-side until the move settles (see app/api/python/main.py's _execute_cartesian_move/_execute_joint_move), so at most one request is ever in flight here. */
export function useLiveMove(): UseLiveMoveResult {
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Synchronous in-flight guard — `sending` state can't be read reliably between two
  // rapid-fire calls in the same tick (e.g. a fast double jog-click) before React re-renders.
  const inFlight = useRef(false)

  const sendMove = useCallback((machineId: string, body: MoveTargetBody) => {
    if (inFlight.current) return
    inFlight.current = true
    setSending(true)
    setError(null)

    void (async () => {
      try {
        const res = await fetch('/api/robot-move', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ machineId, ...body }),
        })
        const result = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(result.error ?? `Robot move failed (${res.status})`)
        if (result.status && result.status !== 'success') {
          throw new Error(result.error ?? `Move ${result.status}`)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to reach robot.')
      } finally {
        inFlight.current = false
        setSending(false)
      }
    })()
  }, [])

  return { sendMove, sending, error }
}
