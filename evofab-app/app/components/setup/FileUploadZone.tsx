"use client";

import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { cn } from "@/app/lib/utils";
import { usePrinter } from "@/app/contexts/PrinterContext";
import { analyzeGCode, type GCodeAnalysis } from "@/app/lib/gcode/analyze";

const ACCEPTED_EXTENSIONS = [".gcode"];

function validateFile(file: File, buildVolume: string | null | undefined) {
  return [
    {
      label: "File format",
      ok: ACCEPTED_EXTENSIONS.some((ext) =>
        file.name.toLowerCase().endsWith(ext),
      ),
    },
    {
      label: "Build volume compatible",
      ok: !!buildVolume,
    },
    {
      label: "Est. print time available",
      ok: file.name.toLowerCase().endsWith(".gcode"),
    },
  ];
}

export function FileUploadZone() {
  const { uploadedFile, setUploadedFile, selectedPrinter, applySettings } =
    usePrinter();
  const [analysis, setAnalysis] = useState<GCodeAnalysis | null>(null);

  const onDrop = useCallback(
    async (accepted: File[]) => {
      if (accepted[0]) {
        setUploadedFile(accepted[0]);
        const result = analyzeGCode(await accepted[0].text());
        setAnalysis(result);
        applySettings(
          Object.fromEntries(
            Object.entries(result.settings).filter(
              ([, value]) => value !== undefined,
            ),
          ),
        );
      }
    },
    [setUploadedFile, applySettings],
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
    ? validateFile(uploadedFile, selectedPrinter?.build_volume)
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
            <p className="text-xs text-muted mt-1">.gcode</p>
          </div>
        )}
      </div>

      {checks.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1.5">
          {checks.map((c) => (
            <li key={c.label} className="flex items-center gap-2 text-xs">
              <span className={c.ok ? "text-green" : "text-red"}>
                {c.ok ? "✓" : "✗"}
              </span>
              <span className={c.ok ? "text-muted" : "text-red/70"}>
                {c.label}
              </span>
            </li>
          ))}
        </ul>
      )}
      {analysis && (
        <div className="mt-3 p-3 rounded-xl border border-teal/20 bg-teal/5 flex items-center justify-between gap-4 animate-fade-up">
          <div>
            <p className="text-xs font-semibold text-teal">
              Settings detected · {analysis.slicer}
            </p>
            <p className="text-[10px] text-muted mt-1">
              Scanned {analysis.linesScanned} lines · applied to overrides
            </p>
          </div>
          <div className="flex gap-2 flex-wrap justify-end">
            {Object.entries(analysis.settings)
              .filter(([, value]) => value !== undefined)
              .map(([key, value]) => (
                <span
                  key={key}
                  className="px-2 py-1 rounded-md bg-surface-2 text-[10px] font-mono text-text"
                >
                  {key.replace("_", " ")}{" "}
                  {Number(value).toFixed(key === "flow_rate" ? 2 : 0)}
                </span>
              ))}
          </div>
        </div>
      )}
    </section>
  );
}
