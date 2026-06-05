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

  useEffect(() => {
    const supabase = createClient()

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
