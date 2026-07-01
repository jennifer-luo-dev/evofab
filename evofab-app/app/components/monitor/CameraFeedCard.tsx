"use client";

interface CameraFeedCardProps {
  live?: boolean;
  showCrosshair?: boolean;
}

export function CameraFeedCard({
  live = false,
  showCrosshair = false,
}: CameraFeedCardProps) {
  return (
    <div className="p-5 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-[var(--color-muted)]">
          Camera
        </h3>
        <span className="font-mono text-xs text-[var(--color-teal)]">
          Orbbec 335L
        </span>
      </div>

      <div
        className="relative w-full bg-black rounded-lg overflow-hidden"
        style={{ aspectRatio: "16/9" }}
      >
        {/* Live overlay */}
        {live && (
          <div className="absolute top-3 left-3 flex items-center gap-1.5 z-10">
            <span className="w-2 h-2 rounded-full bg-[var(--color-red)] animate-pulse-dot" />
            <span className="text-xs font-mono font-bold text-white">LIVE</span>
          </div>
        )}

        {live && (
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_68%,rgba(0,212,180,.22),transparent_24%),linear-gradient(135deg,#0d1322,#05070d)]">
            <div className="absolute left-[28%] right-[28%] bottom-[18%] h-[44%] border border-teal/30 rounded-[45%_45%_18%_18%] bg-gradient-to-t from-teal/20 to-white/5 shadow-[0_20px_60px_rgba(0,212,180,.12)]" />
            <div className="absolute left-[12%] right-[12%] bottom-[13%] h-px bg-teal/30" />
            <div
              className="absolute inset-0 opacity-20"
              style={{
                backgroundImage:
                  "linear-gradient(rgba(255,255,255,.08) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.08) 1px,transparent 1px)",
                backgroundSize: "32px 32px",
              }}
            />
          </div>
        )}
        {!live && (
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
  );
}
