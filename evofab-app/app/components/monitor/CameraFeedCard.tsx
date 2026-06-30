// CameraFeedCard.tsx
// Monitor card displaying the Orbbec 335L MJPEG stream, with optional live
// badge and alignment crosshair overlay for the photo-booth pipeline step.

'use client'

import { useState } from 'react'
import { cn } from '@/app/lib/utils'

interface CameraFeedCardProps {
  live?: boolean
  showCrosshair?: boolean
  streamUrl?: string | null
}

/**
 * Camera feed card showing the Orbbec 335L MJPEG stream.
 * Falls back to a standby state if the stream URL is absent or the image fails to load.
 */
export function CameraFeedCard({ live = false, showCrosshair = false, streamUrl }: CameraFeedCardProps) {
  const [streamError, setStreamError] = useState(false)
  const showStream = !!streamUrl && !streamError
  return (
    <div className="p-5 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-[var(--color-muted)]">
          Camera
        </h3>
        <span className="font-mono text-xs text-[var(--color-teal)]">Orbbec 335L</span>
      </div>

      <div className="relative w-full bg-black rounded-lg overflow-hidden" style={{ aspectRatio: '16/9' }}>
        {/* Live overlay */}
        {live && (
          <div className="absolute top-3 left-3 flex items-center gap-1.5 z-10">
            <span className="w-2 h-2 rounded-full bg-[var(--color-red)] animate-pulse-dot" />
            <span className="text-xs font-mono font-bold text-white">LIVE</span>
          </div>
        )}

        {showStream && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={streamUrl!}
            alt="Camera feed"
            className="absolute inset-0 w-full h-full object-cover scale-x-[-1] scale-y-[-1]"
            onError={() => setStreamError(true)}
          />
        )}

        {!showStream && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-xs font-mono text-[var(--color-muted)] uppercase tracking-widest">
              Standby
            </span>
          </div>
        )}

        {/* Crosshair alignment guides (shown during photo booth step) */}
        {showCrosshair && (
          <>
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-px h-full bg-[var(--color-teal)]/30" />
            </div>
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="h-px w-full bg-[var(--color-teal)]/30" />
            </div>
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-12 h-12 rounded-full border border-[var(--color-teal)]/50" />
            </div>
          </>
        )}
      </div>
    </div>
  )
}
