// page.tsx (camera-test)
// TEMPORARY diagnostic page — polls the standalone Orbbec bridge's
// GET /capture (camera_orbbec_service.py, port 8002) directly for a live
// camera feed, independent of the pipeline builder. Remove once no longer
// needed.

'use client';

import { useEffect, useState } from 'react';

const API = 'http://localhost:8002';
const POLL_MS = 500;

/** Temporary live camera feed test page — polls the Orbbec bridge directly. */
export default function CameraTestPage() {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), POLL_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="max-w-3xl mx-auto mt-12 px-6 space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-text">Camera Test — Live Feed</h1>
        <p className="text-sm text-muted mt-1">
          Temporary diagnostic page. Polls the Orbbec bridge (port 8002) directly via GET /capture,
          every {POLL_MS}ms — bypasses the pipeline builder and main.py entirely.
        </p>
      </div>

      <div
        className="relative w-full bg-black rounded-lg overflow-hidden"
        style={{ aspectRatio: '16/9' }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`${API}/capture?t=${tick}`}
          alt="Live camera feed"
          className="absolute inset-0 w-full h-full object-cover"
        />
        <div className="absolute top-2 left-2 flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse-dot" />
          <span className="text-[10px] font-mono font-bold text-white">LIVE</span>
        </div>
      </div>

      <p className="text-xs text-muted font-mono">poll #{tick}</p>
    </div>
  );
}
