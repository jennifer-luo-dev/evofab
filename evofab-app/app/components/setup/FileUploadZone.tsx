// FileUploadZone.tsx
// Setup-flow drag-and-drop print file upload zone; analyzes G-code bounds
// and runs build-volume pre-flight checks against the selected printer.

"use client";

import { useCallback, useEffect, useState } from "react";
import { useDropzone } from "react-dropzone";
import { cn } from "@/app/lib/utils";
import { analyzeGCode, parseBuildVolume } from "@/app/lib/gcode";
import { usePrinter } from "@/app/contexts/PrinterContext";
import type { GCodeBounds } from "@/app/lib/gcode";

const ACCEPTED_EXTENSIONS = [".gcode", ".stl", ".3mf"];

type CheckResult = { label: string; detail?: string; ok: boolean | null };

/** Builds the pre-flight checklist (format, build-volume fit, time estimate) shown for an uploaded file. */
function buildChecks(
  file: File,
  buildVolume: string | null | undefined,
  bounds: GCodeBounds | null | "loading",
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

/** Drag-and-drop print file upload zone; analyzes G-code bounds and runs build-volume checks. */
export function FileUploadZone() {
  const { uploadedFile, setUploadedFile, selectedPrinter, applySettings } =
    usePrinter();
  const [bounds, setBounds] = useState<GCodeBounds | null | "loading">(null);

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
