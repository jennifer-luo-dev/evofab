// page.tsx (camera-test)
// Classification test tool — live-previews the Orbbec bridge feed (port
// 8002), then on "Capture & Classify" grabs one synced photo+distance pair
// and runs it through main.py's curvature classifier (port 8001), showing
// the server-annotated result (bbox + spine + fit arc already drawn) next
// to a manually-entered expected value for quick model-accuracy checks.

'use client';

import { useEffect, useState } from 'react';
import { classifyImage, type ClassifyResult } from '@/app/lib/classification';

const ORBBEC_API = 'http://localhost:8002';
const MAIN_API_IP = 'localhost';
const MAIN_API_PORT = 8001;
const POLL_MS = 500;

const STATUS_OPTIONS = ['TRACKING', 'NO_TARGET', 'MATH_ERROR'] as const;

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Same reduction as camera_orbbec_service.py's _median_nonzero_depth_mm:
 * median of nonzero raw values (0 = no return), scaled by the frame's own
 * reported depth_scale — not assumed. */
function medianNonzeroDistanceMm(depthBytes: Uint8Array, scale: number): number | null {
  const values = new Uint16Array(depthBytes.buffer, depthBytes.byteOffset, depthBytes.byteLength / 2);
  const nonzero: number[] = [];
  for (let i = 0; i < values.length; i++) if (values[i] !== 0) nonzero.push(values[i]);
  if (nonzero.length === 0) return null;
  nonzero.sort((a, b) => a - b);
  const mid = Math.floor(nonzero.length / 2);
  const median = nonzero.length % 2 === 0 ? (nonzero[mid - 1] + nonzero[mid]) / 2 : nonzero[mid];
  return median * scale;
}

/** Live camera feed + classification test tool — captures a photo/distance pair from the
 * Orbbec bridge, classifies it, and compares the result against a manually-entered expected value. */
export default function CameraTestPage() {
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [distanceMm, setDistanceMm] = useState<number | null>(null);
  const [result, setResult] = useState<ClassifyResult | null>(null);
  const [expected, setExpected] = useState({ status: 'TRACKING', bendAngleDeg: '', radiusMm: '' });

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), POLL_MS);
    return () => clearInterval(id);
  }, []);

  async function handleCaptureAndClassify() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${ORBBEC_API}/capture/depth_and_color`);
      if (!res.ok) {
        throw new Error(`Capture failed (${res.status}): ${await res.text()}`);
      }
      const data = await res.json();
      const colorBytes = base64ToBytes(data.color_jpeg_b64);
      const depthBytes = base64ToBytes(data.depth_b64);
      // TS's lib.dom types Blob's BlobPart as ArrayBufferView<ArrayBuffer>
      // specifically, while Uint8Array is generic over ArrayBufferLike —
      // these Uint8Arrays are always backed by a plain ArrayBuffer (freshly
      // allocated in base64ToBytes), so the cast is safe.
      const colorBlob = new Blob([colorBytes as BlobPart], { type: 'image/jpeg' });
      const depthBlob = new Blob([depthBytes as BlobPart]);

      const classifyResult = await classifyImage(MAIN_API_IP, MAIN_API_PORT, colorBlob, {
        depth: {
          data: depthBlob,
          width: data.depth_width,
          height: data.depth_height,
          scale: data.depth_scale,
        },
      });

      setDistanceMm(medianNonzeroDistanceMm(depthBytes, data.depth_scale));
      setResult(classifyResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto mt-12 px-6 space-y-6 pb-12">
      <div>
        <h1 className="text-xl font-semibold text-text">Camera Test — Classification Accuracy</h1>
        <p className="text-sm text-muted mt-1">
          Live preview polls the Orbbec bridge (port 8002) directly. &quot;Capture &amp; Classify&quot;
          grabs one photo/distance pair and runs it through the curvature classifier (port 8001) so you
          can compare its output against an expected value.
        </p>
      </div>

      <div
        className="relative w-full bg-black rounded-lg overflow-hidden"
        style={{ aspectRatio: '16/9' }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`${ORBBEC_API}/capture?t=${tick}`}
          alt="Live camera feed"
          className="absolute inset-0 w-full h-full object-cover"
        />
        <div className="absolute top-2 left-2 flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse-dot" />
          <span className="text-[10px] font-mono font-bold text-white">LIVE</span>
        </div>
      </div>

      <button
        type="button"
        onClick={handleCaptureAndClassify}
        disabled={busy}
        className="rounded-lg px-4 py-3 text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-teal text-white hover:opacity-90 active:opacity-80 hover:cursor-pointer"
      >
        {busy ? 'Capturing…' : 'Capture & Classify'}
      </button>

      {error && <p className="text-sm text-red-500">{error}</p>}

      {result && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <h2 className="text-sm font-semibold text-text">Annotated result</h2>
            {result.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={result.image_url}
                alt="Annotated classification result"
                className="w-full rounded-lg border border-border"
              />
            ) : (
              <p className="text-xs text-muted">No annotated image returned.</p>
            )}
          </div>

          <div className="space-y-4">
            <div>
              <h2 className="text-sm font-semibold text-text">Actual</h2>
              <dl className="text-sm mt-1 space-y-0.5">
                <Row label="Status" value={result.analysis_status} />
                <Row label="Distance" value={distanceMm != null ? `${distanceMm.toFixed(1)} mm` : '—'} />
                <Row label="Curvature" value={result.mean_curvature != null ? `${result.mean_curvature.toFixed(2)} 1/m` : '—'} />
                <Row label="Bend angle" value={result.bend_angle_deg != null ? `${result.bend_angle_deg.toFixed(1)}°` : '—'} />
                <Row label="Radius" value={result.radius_mm != null ? `${result.radius_mm.toFixed(0)} mm` : '—'} />
              </dl>
            </div>

            <div>
              <h2 className="text-sm font-semibold text-text">Expected</h2>
              <div className="text-sm mt-1 space-y-2">
                <label className="flex items-center justify-between gap-2">
                  <span className="text-muted">Status</span>
                  <select
                    value={expected.status}
                    onChange={(e) => setExpected((prev) => ({ ...prev, status: e.target.value }))}
                    className="border border-border rounded bg-surface px-2 py-1 text-sm text-text"
                  >
                    {STATUS_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center justify-between gap-2">
                  <span className="text-muted">Bend angle (°)</span>
                  <input
                    type="number"
                    value={expected.bendAngleDeg}
                    onChange={(e) => setExpected((prev) => ({ ...prev, bendAngleDeg: e.target.value }))}
                    className="border border-border rounded bg-surface px-2 py-1 text-sm text-text w-24"
                  />
                </label>
                <label className="flex items-center justify-between gap-2">
                  <span className="text-muted">Radius (mm)</span>
                  <input
                    type="number"
                    value={expected.radiusMm}
                    onChange={(e) => setExpected((prev) => ({ ...prev, radiusMm: e.target.value }))}
                    className="border border-border rounded bg-surface px-2 py-1 text-sm text-text w-24"
                  />
                </label>
              </div>
            </div>
          </div>
        </div>
      )}

      <p className="text-xs text-muted font-mono">poll #{tick}</p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-muted">{label}</dt>
      <dd className="font-mono">{value}</dd>
    </div>
  );
}
