'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/app/lib/supabase'
import type { PrinterStatusType } from '@/app/types/printer'

interface DeviceIndicator {
  label: string
  status: PrinterStatusType
  printerId?: string
}

const statusColor: Record<PrinterStatusType, string> = {
  idle:     'bg-green',
  printing: 'bg-amber animate-pulse-dot',
  paused:   'bg-amber',
  error:    'bg-red',
  offline:  'bg-muted',
}

export function Topbar() {
  const [fgfStatus, setFgfStatus] = useState<PrinterStatusType>('offline')
  const [activePrinterId, setActivePrinterId] = useState<string | null>(null)
  const [controlError, setControlError] = useState<string | null>(null)

  useEffect(() => {
    const supabase = createClient()

    supabase
      .from('printer_status')
      .select('printer_id, status')
      .in('status', ['printing', 'paused', 'error'])
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.printer_id) setActivePrinterId(data.printer_id as string)
      })

    // Fetch initial status for printers named FGF-*
    supabase
      .from('printer_status')
      .select('status, printer:printers!inner(name)')
      .eq('printers.name', 'FGF-01')
      .maybeSingle()
      .then(({ data }) => {
        if (data?.status) setFgfStatus(data.status as PrinterStatusType)
      })

    // Subscribe to printer_status changes
    const channel = supabase
      .channel('topbar-printer-status')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'printer_status' },
        async (payload) => {
          const updated = payload.new as { printer_id: string; status: PrinterStatusType }
          if (updated.status === 'printing' || updated.status === 'paused' || updated.status === 'error') {
            setActivePrinterId(updated.printer_id)
          }
          // Look up printer name to decide which indicator to update
          const { data: printer } = await supabase
            .from('printers')
            .select('name')
            .eq('id', updated.printer_id)
            .maybeSingle()
          if (printer?.name === 'FGF-01') {
            setFgfStatus(updated.status)
          }
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [])

  async function triggerEmergencyStop() {
    if (!activePrinterId) return
    setControlError(null)

    const response = await fetch(`/api/printers/${activePrinterId}/control`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'emergency_stop' }),
    })
    const body = await response.json().catch(() => null)

    if (!response.ok) {
      setControlError(body?.error?.message ?? 'Software e-stop failed.')
    }
  }

  const devices: DeviceIndicator[] = [
    { label: 'FGF-01', status: fgfStatus },
    { label: 'UR7e',   status: 'idle' },   // robot arm — not yet in DB
    { label: 'Camera', status: 'idle' },   // camera — not yet in DB
  ]

  return (
    <header className="fixed top-0 left-0 right-0 z-50 h-13 flex items-center justify-between px-6 bg-surface border-b border-border">
      <div className="flex items-center gap-3">
        <span className="font-mono text-teal text-sm font-bold tracking-wider">EVOFAB</span>
        <span className="text-border-2 text-lg select-none">/</span>
        <span className="font-mono text-muted text-xs tracking-wide">SDL</span>
        <div className="w-px h-4 bg-border-2 mx-2" />
        <span className="text-xs text-muted">Nemitz Robotics Lab · Tufts ME</span>
      </div>

      <div className="flex items-center gap-4">
        <button
          onClick={triggerEmergencyStop}
          disabled={!activePrinterId}
          title={activePrinterId ? 'Trigger software e-stop' : 'No active printer'}
          className="rounded-md border border-red/50 bg-red/10 px-3 py-1.5 text-xs font-semibold text-red transition-colors hover:bg-red/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          software e-stop
        </button>
        {controlError && (
          <span className="max-w-52 truncate text-xs text-red" title={controlError}>
            {controlError}
          </span>
        )}
        {devices.map((device) => (
          <div key={device.label} className="flex items-center gap-1.5">
            <span className={`inline-block w-2 h-2 rounded-full ${statusColor[device.status]}`} />
            <span className="font-mono text-xs text-muted">{device.label}</span>
          </div>
        ))}
      </div>
    </header>
  )
}
