"use client";

import { useCallback, useEffect, useState } from "react";
import { useDropzone } from "react-dropzone";
import { cn } from "@/app/lib/utils";
import { usePrinter } from "@/app/contexts/PrinterContext";
import type { PrintSettings } from "@/app/types/job";

const ACCEPTED_EXTENSIONS = [".gcode", ".stl", ".3mf"];

type Bounds = { x: number; y: number; z: number };
type GCodeInfo = { bounds: Bounds | null; settings: Partial<PrintSettings> };

function parseBuildVolume(str: string): Bounds | null {
  const m = str.match(/([\d.]+)[x×]([\d.]+)[x×]([\d.]+)/i);
  if (!m) return null;
  return { x: parseFloat(m[1]), y: parseFloat(m[2]), z: parseFloat(m[3]) };
}

// Find the first numeric match among several patterns.
function firstNum(text: string, ...patterns: RegExp[]): number | undefined {
  for (const p of patterns) {
    const m = text.match(p);
    if (m?.[1]) return parseFloat(m[1]);
  }
}

async function analyzeGCode(file: File): Promise<GCodeInfo> {
  // One header read shared by both bounds and settings extraction.
  const header = await file.slice(0, 64 * 1024).text();

  // ── BOUNDS ────────────────────────────────────────────────────────────────

  let bounds: Bounds | null = null;

  // Cura: ;MINX:0  ;MAXX:150
  const cMaxX = header.match(/;MAXX:([\d.]+)/i)?.[1];
  const cMaxY = header.match(/;MAXY:([\d.]+)/i)?.[1];
  const cMaxZ = header.match(/;MAXZ:([\d.]+)/i)?.[1];
  if (cMaxX && cMaxY && cMaxZ) {
    bounds = {
      x:
        parseFloat(cMaxX) -
        parseFloat(header.match(/;MINX:([\d.]+)/i)?.[1] ?? "0"),
      y:
        parseFloat(cMaxY) -
        parseFloat(header.match(/;MINY:([\d.]+)/i)?.[1] ?? "0"),
      z:
        parseFloat(cMaxZ) -
        parseFloat(header.match(/;MINZ:([\d.]+)/i)?.[1] ?? "0"),
    };
  }

  // PrusaSlicer / OrcaSlicer: ; MAXX = 150
  if (!bounds) {
    const pMaxX = header.match(/;\s*MAXX\s*=\s*([\d.]+)/i)?.[1];
    const pMaxY = header.match(/;\s*MAXY\s*=\s*([\d.]+)/i)?.[1];
    const pMaxZ = header.match(/;\s*MAXZ\s*=\s*([\d.]+)/i)?.[1];
    if (pMaxX && pMaxY && pMaxZ) {
      bounds = {
        x:
          parseFloat(pMaxX) -
          parseFloat(header.match(/;\s*MINX\s*=\s*([\d.]+)/i)?.[1] ?? "0"),
        y:
          parseFloat(pMaxY) -
          parseFloat(header.match(/;\s*MINY\s*=\s*([\d.]+)/i)?.[1] ?? "0"),
        z:
          parseFloat(pMaxZ) -
          parseFloat(header.match(/;\s*MINZ\s*=\s*([\d.]+)/i)?.[1] ?? "0"),
      };
    }
  }

  // Fallback: scan every G0/G1 move in the full file.
  if (!bounds) {
    const text = await file.text();
    let minX = Infinity,
      maxX = -Infinity;
    let minY = Infinity,
      maxY = -Infinity;
    let minZ = Infinity,
      maxZ = -Infinity;
    let found = false;
    for (const raw of text.split("\n")) {
      const line = raw.trimStart().toUpperCase();
      if (!line.startsWith("G0") && !line.startsWith("G1")) continue;
      const x = line.match(/X(-?[\d.]+)/)?.[1];
      const y = line.match(/Y(-?[\d.]+)/)?.[1];
      const z = line.match(/Z(-?[\d.]+)/)?.[1];
      if (x) {
        const v = parseFloat(x);
        minX = Math.min(minX, v);
        maxX = Math.max(maxX, v);
        found = true;
      }
      if (y) {
        const v = parseFloat(y);
        minY = Math.min(minY, v);
        maxY = Math.max(maxY, v);
        found = true;
      }
      if (z) {
        const v = parseFloat(z);
        minZ = Math.min(minZ, v);
        maxZ = Math.max(maxZ, v);
        found = true;
      }
    }
    if (found) bounds = { x: maxX - minX, y: maxY - minY, z: maxZ - minZ };
  }

  // ── PRINT SETTINGS ────────────────────────────────────────────────────────
  // Comment patterns cover PrusaSlicer, OrcaSlicer, Cura, Bambu Studio.
  // GCode command patterns (M104/M109, M140/M190, M106, M221) are the fallback.

  const settings: Partial<PrintSettings> = {};

  const nozzle = firstNum(
    header,
    /;\s*nozzle_temperature\s*[=:]\s*([\d.]+)/i,
    /;\s*temperature\s*[=:]\s*([\d.]+)/i,
    /M(?:104|109)\s+[^;\n]*S(\d+)/i,
  );
  if (nozzle !== undefined) settings.nozzle_temp = nozzle;

  const bed = firstNum(
    header,
    /;\s*(?:bed_temperature|first_layer_bed_temperature|material_bed_temperature)\s*[=:]\s*([\d.]+)/i,
    /M(?:140|190)\s+[^;\n]*S(\d+)/i,
  );
  if (bed !== undefined) settings.bed_temp = bed;

  // Speed comments are in mm/s (Cura: speed_print, PrusaSlicer: perimeter_speed).
  const speed = firstNum(
    header,
    /;\s*(?:speed_print|perimeter_speed|print_speed)\s*[=:]\s*([\d.]+)/i,
  );
  if (speed !== undefined) settings.speed = speed;

  // extrusion_multiplier is already a ratio (e.g. 0.94); M221 S is a percentage (95 → 0.95).
  const flowRaw = firstNum(
    header,
    /;\s*(?:extrusion_multiplier|flow_ratio)\s*[=:]\s*([\d.]+)/i,
    /M221\s+[^;\n]*S(\d+)/i,
  );
  if (flowRaw !== undefined)
    settings.flow_rate = flowRaw > 2 ? flowRaw / 100 : flowRaw;

  // Fan comments are 0–100 %; M106 S is 0–255 PWM.
  const fanRaw = firstNum(
    header,
    /;\s*(?:fan_speed|cooling_fan_speed|part_cooling_fan_speed|max_fan_speed)\s*[=:]\s*([\d.]+)/i,
    /M106\s+[^;\n]*S(\d+)/i,
  );
  if (fanRaw !== undefined)
    settings.fan_speed =
      fanRaw > 100 ? Math.round((fanRaw / 255) * 100) : Math.round(fanRaw);

  return { bounds, settings };
}

type CheckResult = { label: string; detail?: string; ok: boolean | null };

function buildChecks(
  file: File,
  buildVolume: string | null | undefined,
  bounds: Bounds | null | "loading",
): CheckResult[] {
  const isGcode = file.name.toLowerCase().endsWith(".gcode");

  const volumeCheck = (): CheckResult => {
    if (!isGcode)
      return {
        label: "Build volume compatible",
        detail: "requires .gcode",
        ok: null,
      };
    if (bounds === "loading")
      return {
        label: "Build volume compatible",
        detail: "analyzing…",
        ok: null,
      };
    if (!buildVolume)
      return {
        label: "Build volume compatible",
        detail: "select a printer first",
        ok: null,
      };
    const vol = parseBuildVolume(buildVolume);
    if (!vol || !bounds)
      return {
        label: "Build volume compatible",
        detail: "could not determine",
        ok: null,
      };
    const fits = bounds.x <= vol.x && bounds.y <= vol.y && bounds.z <= vol.z;
    return {
      label: "Build volume compatible",
      detail: `${bounds.x.toFixed(1)}×${bounds.y.toFixed(1)}×${bounds.z.toFixed(1)} mm`,
      ok: fits,
    };
  };

  return [
    {
      label: "File format",
      ok: ACCEPTED_EXTENSIONS.some((ext) =>
        file.name.toLowerCase().endsWith(ext),
      ),
    },
    volumeCheck(),
    {
      label: "Est. print time available",
      ok: isGcode,
      detail: isGcode ? undefined : "requires .gcode",
    },
  ];
}

export function FileUploadZone() {
  const { uploadedFile, setUploadedFile, selectedPrinter, applySettings } =
    usePrinter();
  const [bounds, setBounds] = useState<Bounds | null | "loading">(null);

  useEffect(() => {
    if (!uploadedFile?.name.toLowerCase().endsWith(".gcode")) {
      setBounds(null);
      return;
    }
    setBounds("loading");
    analyzeGCode(uploadedFile).then(({ bounds: b, settings }) => {
      setBounds(b);
      if (Object.keys(settings).length > 0) applySettings(settings);
    });
  }, [uploadedFile, applySettings]);

  const onDrop = useCallback(
    (accepted: File[]) => {
      if (accepted[0]) setUploadedFile(accepted[0]);
    },
    [setUploadedFile],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    multiple: false,
    accept: {
      "application/octet-stream": ACCEPTED_EXTENSIONS,
      "text/plain": [".gcode"],
    },
  });

  const checks = uploadedFile
    ? buildChecks(uploadedFile, selectedPrinter?.build_volume, bounds)
    : [];

  return (
    <section>
      <h2 className="text-xs font-semibold uppercase tracking-widest text-muted mb-3">
        Print File
      </h2>
      <div
        {...getRootProps()}
        className={cn(
          "flex flex-col items-center justify-center gap-3 p-8 rounded-xl border-2 border-dashed cursor-pointer transition-all duration-150",
          isDragActive
            ? "border-teal bg-teal-dim"
            : uploadedFile
              ? "border-green bg-green/5"
              : "border-border-2 hover:border-border-2 hover:bg-white/2",
        )}
      >
        <input {...getInputProps()} />
        <span className="text-2xl">{uploadedFile ? "✓" : "⬆"}</span>
        {uploadedFile ? (
          <p className="text-sm font-mono text-green">{uploadedFile.name}</p>
        ) : (
          <div className="text-center">
            <p className="text-sm text-text">
              {isDragActive
                ? "Drop file here"
                : "Drag & drop or click to upload"}
            </p>
            <p className="text-xs text-muted mt-1">.gcode · .stl · .3mf</p>
          </div>
        )}
      </div>

      {checks.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1.5">
          {checks.map((c) => (
            <li key={c.label} className="flex items-center gap-2 text-xs">
              <span
                className={
                  c.ok === true
                    ? "text-green"
                    : c.ok === false
                      ? "text-red"
                      : "text-muted"
                }
              >
                {c.ok === true ? "✓" : c.ok === false ? "✗" : "–"}
              </span>
              <span className={c.ok === false ? "text-red/70" : "text-muted"}>
                {c.label}
              </span>
              {c.detail && <span className=" text-muted">{c.detail}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
