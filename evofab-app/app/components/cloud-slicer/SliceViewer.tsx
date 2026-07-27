"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  GcodeArtifactAnalysis,
  PreviewTrust,
} from "@/app/lib/gcode-artifact-analysis";
import type { BuildVolumeMm } from "@/app/lib/printability";
import type { SlicerArtifactProvenance } from "@/app/lib/slicer-client";
import { preparationQuaternion } from "@/app/lib/preparation-orientation";
import {
  phaseJPreviewAdapter,
  type PreviewGeometryMetadata,
  type SlicePreviewRenderer,
} from "./preview-adapter";

interface SliceViewerProps {
  file: File | null;
  rotation: number[] | null;
  gcode: string | null;
  status: string;
  buildVolume: BuildVolumeMm;
  previewTrust: PreviewTrust | null;
  provenance: SlicerArtifactProvenance | undefined;
  geometry: PreviewGeometryMetadata;
  onRendererState: (state: "pending" | "ready" | "failed") => void;
}

function SourceModelView({
  file,
  rotation,
  simulation,
}: {
  file: File | null;
  rotation: number[] | null;
  simulation: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !file) return;
    const sourceCanvas = canvas;
    const sourceFile = file;
    let cancelled = false;
    let frame = 0;
    let dispose = () => {};
    async function render() {
      try {
        const THREE = await import("three");
        const { OrbitControls } =
          await import("three/examples/jsm/controls/OrbitControls.js");
        const { STLLoader } =
          await import("three/examples/jsm/loaders/STLLoader.js");
        const [buffer] = await Promise.all([sourceFile.arrayBuffer()]);
        if (cancelled) return;
        const renderer = new THREE.WebGLRenderer({
          canvas: sourceCanvas,
          antialias: true,
        });
        const scene = new THREE.Scene();
        scene.background = new THREE.Color("#111927");
        const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 5000);
        const controls = new OrbitControls(camera, sourceCanvas);
        const geometry = new STLLoader().parse(buffer);
        geometry.computeVertexNormals();
        geometry.computeBoundingBox();
        const box = geometry.boundingBox;
        const size = new THREE.Vector3();
        box?.getSize(size);
        const material = new THREE.MeshStandardMaterial({
          color: "#9cc7d6",
          metalness: 0.05,
          roughness: 0.7,
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.rotation.x = -Math.PI / 2;
        const sourceRotation = preparationQuaternion(rotation);
        if (sourceRotation) {
          mesh.quaternion.multiply(
            new THREE.Quaternion(
              sourceRotation[0],
              sourceRotation[1],
              sourceRotation[2],
              sourceRotation[3],
            ),
          );
        }
        mesh.updateMatrixWorld(true);
        const preparedBox = new THREE.Box3().setFromObject(mesh);
        const preparedCenter = preparedBox.getCenter(new THREE.Vector3());
        mesh.position.x -= preparedCenter.x;
        mesh.position.z -= preparedCenter.z;
        mesh.position.y -= preparedBox.min.y - 0.08;
        mesh.updateMatrixWorld(true);
        scene.add(mesh, new THREE.AmbientLight(0xffffff, 0.75));
        const light = new THREE.DirectionalLight(0xffffff, 0.9);
        light.position.set(30, 50, 40);
        scene.add(light);
        const radius = Math.max(size.length(), 10);
        camera.position.set(radius, radius * 0.8, radius);
        controls.target.set(0, Math.max(size.y, size.z) / 2, 0);
        controls.update();
        const resize = () => {
          const rect = sourceCanvas.getBoundingClientRect();
          renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
          renderer.setSize(
            Math.max(1, rect.width),
            Math.max(1, rect.height),
            false,
          );
          camera.aspect = Math.max(1, rect.width) / Math.max(1, rect.height);
          camera.updateProjectionMatrix();
        };
        const animate = () => {
          resize();
          controls.update();
          renderer.render(scene, camera);
          frame = requestAnimationFrame(animate);
        };
        animate();
        dispose = () => {
          cancelAnimationFrame(frame);
          controls.dispose();
          geometry.dispose();
          material.dispose();
          renderer.dispose();
        };
      } catch {
        if (!cancelled) setError("Unable to render the source STL.");
      }
    }
    render();
    return () => {
      cancelled = true;
      dispose();
    };
  }, [file, rotation]);

  return (
    <div className="relative min-h-[500px] overflow-hidden rounded-lg border border-[var(--color-border)] bg-[#111927]">
      <canvas
        ref={canvasRef}
        className="min-h-[500px] w-full"
        data-testid="source-model-canvas"
        data-preparation-rotation={
          preparationQuaternion(rotation)?.join(",") ?? "identity"
        }
      />
      <p className="absolute left-4 top-4 max-w-sm rounded bg-black/65 px-3 py-2 text-xs text-white/85">
        {simulation
          ? "Source model view. This STL uses the accepted preparation orientation, but the simulation toolpath is fixed and is not comparable source output."
          : "Source model view. This STL uses the accepted preparation orientation; it is reference geometry, not the generated toolpath."}
      </p>
      {error && (
        <p
          role="alert"
          className="absolute bottom-4 left-4 text-sm text-[var(--color-red)]"
        >
          {error}
        </p>
      )}
    </div>
  );
}

function AnalysisSummary({ analysis }: { analysis: GcodeArtifactAnalysis }) {
  const bounds = analysis.bounds;
  return (
    <dl className="grid grid-cols-2 gap-3 rounded-lg border border-white/10 bg-black/30 p-3 text-xs text-white/80 md:grid-cols-4">
      <div>
        <dt className="text-white/50">Artifact</dt>
        <dd>
          {analysis.byteCount.toLocaleString()} bytes ·{" "}
          {analysis.lineCount.toLocaleString()} lines
        </dd>
      </div>
      <div>
        <dt className="text-white/50">Extrusion</dt>
        <dd>
          {analysis.extrusionMoveCount} moves ·{" "}
          {analysis.extrusionPathLengthMm.toFixed(1)} mm
        </dd>
      </div>
      <div>
        <dt className="text-white/50">Bounds</dt>
        <dd>
          {bounds
            ? `${(bounds.maxX - bounds.minX).toFixed(1)} × ${(bounds.maxY - bounds.minY).toFixed(1)} × ${(bounds.maxZ - bounds.minZ).toFixed(1)} mm`
            : "none"}
        </dd>
      </div>
      <div>
        <dt className="text-white/50">Normalized SHA-256</dt>
        <dd
          className="truncate font-mono"
          title={analysis.normalizedHash ?? ""}
        >
          {analysis.normalizedHash?.slice(0, 12) ?? "pending"}
        </dd>
      </div>
    </dl>
  );
}

export function SliceViewer({
  file,
  rotation,
  gcode,
  status,
  buildVolume,
  previewTrust,
  provenance,
  geometry,
  onRendererState,
}: SliceViewerProps) {
  const { x: buildVolumeX, y: buildVolumeY, z: buildVolumeZ } = buildVolume;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<SlicePreviewRenderer | null>(null);
  const layers = useMemo(
    () => (gcode ? phaseJPreviewAdapter.parse(gcode) : []),
    [gcode],
  );
  const layerMax = Math.max(0, layers.length - 1);
  const [selectedRange, setSelectedRange] = useState(() => ({
    artifact: gcode,
    firstLayer: 0,
    lastLayer: layerMax,
  }));
  const [selectedTravel, setSelectedTravel] = useState(() => ({
    artifact: gcode,
    value: false,
  }));
  const [view, setView] = useState<"toolpath" | "source">("toolpath");
  const [rendererState, setRendererState] = useState<{
    artifact: string | null;
    ready: boolean;
    error: string | null;
  }>({ artifact: null, ready: false, error: null });
  // G-code can arrive after the viewer mounts. A new artifact derives a full
  // range and hidden travel without an effect-driven state reset; selections
  // made against the same artifact remain intact and are safely clamped.
  const rangeForArtifact =
    selectedRange.artifact === gcode
      ? selectedRange
      : { firstLayer: 0, lastLayer: layerMax };
  const firstLayer = Math.min(
    Math.max(0, rangeForArtifact.firstLayer),
    layerMax,
  );
  const lastLayer = Math.max(
    firstLayer,
    Math.min(rangeForArtifact.lastLayer, layerMax),
  );
  const showTravel =
    selectedTravel.artifact === gcode ? selectedTravel.value : false;
  const rendererReady = rendererState.artifact === gcode && rendererState.ready;
  const renderError =
    rendererState.artifact === gcode ? rendererState.error : null;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !gcode || !previewTrust?.analysis) return;
    const rendererBuildVolume = {
      x: buildVolumeX,
      y: buildVolumeY,
      z: buildVolumeZ,
    };
    let cancelled = false;
    onRendererState("pending");
    phaseJPreviewAdapter
      .createRenderer({
        canvas,
        gcode,
        layers,
        analysis: previewTrust.analysis,
        buildVolume: rendererBuildVolume,
        geometry,
        options: {
          startLayer: 0,
          endLayer: Math.max(0, layers.length - 1),
          showTravel: false,
        },
      })
      .then((renderer) => {
        if (cancelled) return renderer.dispose();
        rendererRef.current = renderer;
        setRendererState({ artifact: gcode, ready: true, error: null });
        onRendererState("ready");
      })
      .catch(() => {
        if (!cancelled) {
          setRendererState({
            artifact: gcode,
            ready: false,
            error: "Toolpath preview failed. Printer upload remains blocked.",
          });
          onRendererState("failed");
        }
      });
    return () => {
      cancelled = true;
      rendererRef.current?.dispose();
      rendererRef.current = null;
    };
  }, [
    buildVolumeX,
    buildVolumeY,
    buildVolumeZ,
    gcode,
    geometry,
    layers,
    onRendererState,
    previewTrust?.analysis,
  ]);

  useEffect(() => {
    rendererRef.current?.update({
      startLayer: firstLayer,
      endLayer: lastLayer,
      showTravel,
    });
  }, [firstLayer, lastLayer, showTravel]);

  const layerLabel = layers.length
    ? `Layers ${firstLayer + 1}–${lastLayer + 1} of ${layers.length}`
    : status === "failed"
      ? "Slice failed"
      : "Waiting for a successful slice";
  const visibleSampleLayers = [0, Math.floor(layerMax / 2), layerMax].filter(
    (layer, index, samples) =>
      layer >= firstLayer &&
      layer <= lastLayer &&
      samples.indexOf(layer) === index,
  );

  return (
    <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-[var(--color-text)]">
            Slice Preview
          </h2>
          <p className="mt-1 text-xs font-mono text-[var(--color-muted)]">
            {layerLabel}
          </p>
        </div>
        <div className="flex gap-2" aria-label="Preview view">
          <button
            type="button"
            aria-pressed={view === "toolpath"}
            onClick={() => setView("toolpath")}
            className="rounded border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-text)]"
          >
            Toolpath
          </button>
          <button
            type="button"
            aria-pressed={view === "source"}
            onClick={() => setView("source")}
            className="rounded border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-text)]"
          >
            Source model
          </button>
        </div>
      </div>
      {previewTrust && (
        <div className="mt-4 space-y-3">
          {provenance?.kind === "mock" && (
            <p
              role="alert"
              className="rounded border border-[var(--color-amber)]/50 bg-[var(--color-amber)]/10 px-3 py-2 text-sm text-[var(--color-amber)]"
            >
              Simulation mode — this fixed test toolpath was not generated from
              the uploaded STL. Printer handoff is disabled.
            </p>
          )}
          <p
            className={
              previewTrust.status === "trusted"
                ? "text-sm text-[var(--color-green)]"
                : "text-sm text-[var(--color-amber)]"
            }
          >
            {provenance?.kind === "mock"
              ? "Simulation metrics are shown for UI testing only; they are not printer trust evidence."
              : previewTrust.status === "trusted"
                ? "Preview trusted — upload may be enabled after this renderer is ready."
                : "Preview blocked — resolve the evidence below before upload."}
          </p>
          <p className="text-xs text-[var(--color-muted)]">
            Server reported {previewTrust.reportedLayerCount ?? "no"} layers ·
            parser rendered {previewTrust.analysis.parsedLayerCount} layers
          </p>
          {previewTrust.reasons.length > 0 && (
            <ul
              role="alert"
              className="list-disc space-y-1 pl-5 text-xs text-[var(--color-amber)]"
            >
              {previewTrust.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          )}
          <AnalysisSummary analysis={previewTrust.analysis} />
        </div>
      )}
      {layers.length > 0 && (
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <label className="text-xs text-[var(--color-muted)]">
            First visible layer
            <input
              aria-label="First visible layer"
              type="range"
              min={0}
              max={layerMax}
              value={firstLayer}
              onChange={(event) =>
                setSelectedRange({
                  artifact: gcode,
                  firstLayer: Math.min(Number(event.target.value), lastLayer),
                  lastLayer,
                })
              }
              className="mt-1 w-full accent-[var(--color-teal)]"
            />
          </label>
          <label className="text-xs text-[var(--color-muted)]">
            Last visible layer
            <input
              aria-label="Last visible layer"
              type="range"
              min={0}
              max={layerMax}
              value={lastLayer}
              onChange={(event) =>
                setSelectedRange({
                  artifact: gcode,
                  firstLayer,
                  lastLayer: Math.max(Number(event.target.value), firstLayer),
                })
              }
              className="mt-1 w-full accent-[var(--color-teal)]"
            />
          </label>
          <label className="flex items-center gap-2 self-end pb-1 text-xs text-[var(--color-muted)]">
            <input
              aria-label="Show travel moves"
              type="checkbox"
              checked={showTravel}
              onChange={(event) =>
                setSelectedTravel({
                  artifact: gcode,
                  value: event.target.checked,
                })
              }
            />{" "}
            Show travel moves
          </label>
        </div>
      )}
      <div className="mt-4">
        {view === "source" ? (
          <SourceModelView
            file={file}
            rotation={rotation}
            simulation={provenance?.kind === "mock"}
          />
        ) : (
          <div className="relative min-h-[500px] overflow-hidden rounded-lg border border-[var(--color-border)] bg-[#111927]">
            <canvas
              ref={canvasRef}
              className="min-h-[500px] w-full"
              data-testid="toolpath-canvas"
              data-visible-layer-range={`${firstLayer}-${lastLayer}`}
              data-visible-sample-layers={visibleSampleLayers.join(",")}
            />
            <p className="absolute left-4 top-4 rounded bg-black/65 px-3 py-2 text-xs text-white/85">
              Generated extrusion toolpath · travel{" "}
              {showTravel ? "visible" : "hidden"}
            </p>
            {rendererReady && (
              <p className="sr-only" role="status">
                Toolpath renderer ready
              </p>
            )}
            {renderError && (
              <p
                role="alert"
                className="absolute bottom-4 left-4 text-sm text-[var(--color-red)]"
              >
                {renderError}
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
