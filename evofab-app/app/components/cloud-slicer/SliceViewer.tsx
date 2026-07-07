"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  layerTotalFromGcode,
  parseGcodeLayers,
  type GcodeLayer,
  type GcodeLineType,
  type GcodeSegment,
} from "@/app/lib/gcode-layer-parser";

interface SliceViewerProps {
  file: File | null;
  gcode: string | null;
  status: string;
  rotation: number[] | null;
  onOrientationChange: (rotation: number[] | null) => void;
}

const LINE_TYPES: Array<{
  id: GcodeLineType;
  label: string;
  color: number;
  swatch: string;
}> = [
  { id: "outer_wall", label: "Outer wall", color: 0xff8a3d, swatch: "#ff8a3d" },
  { id: "inner_wall", label: "Inner wall", color: 0xffde59, swatch: "#ffde59" },
  {
    id: "sparse_infill",
    label: "Sparse infill",
    color: 0xc53030,
    swatch: "#c53030",
  },
  {
    id: "top_surface",
    label: "Top surface",
    color: 0xff4141,
    swatch: "#ff4141",
  },
  { id: "travel", label: "Travel", color: 0x4654b8, swatch: "#4654b8" },
  { id: "unknown", label: "Other", color: 0xe5e7eb, swatch: "#e5e7eb" },
];

function segmentLength(segment: GcodeSegment): number {
  const dx = segment.to.x - segment.from.x;
  const dy = segment.to.y - segment.from.y;
  const dz = segment.to.z - segment.from.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  if (mins <= 0) return `${secs}s`;
  return `${mins}m${secs.toString().padStart(2, "0")}s`;
}

function lineStats(layers: GcodeLayer[]) {
  const totals = new Map<GcodeLineType, number>();
  for (const layer of layers) {
    for (const segment of layer.segments) {
      totals.set(
        segment.type,
        (totals.get(segment.type) ?? 0) + segmentLength(segment),
      );
    }
  }
  const totalMm = [...totals.values()].reduce((sum, value) => sum + value, 0);
  return LINE_TYPES.map((type) => {
    const lengthMm = totals.get(type.id) ?? 0;
    const pct = totalMm > 0 ? (lengthMm / totalMm) * 100 : 0;
    return {
      ...type,
      lengthMm,
      pct,
      seconds: Math.round(lengthMm * 0.42),
    };
  }).filter((stat) => stat.lengthMm > 0 || stat.id !== "unknown");
}

function gcodePreviewLines(gcode: string | null, layerIndex: number): string[] {
  if (!gcode) return [];
  const lines = gcode.split(/\r?\n/);
  const marker = lines.findIndex((line) =>
    new RegExp(`^;\\s*LAYER[:_]\\s*${layerIndex}\\b`, "i").test(line),
  );
  const start = Math.max(0, (marker >= 0 ? marker : 0) - 3);
  return lines.slice(start, start + 13).map((line, offset) => {
    const lineNo = start + offset + 1;
    return `${lineNo.toString().padStart(5, " ")}  ${line}`;
  });
}

function modelBounds(layers: GcodeLayer[]) {
  const points = layers.flatMap((layer) =>
    layer.segments.flatMap((segment) => [segment.from, segment.to]),
  );
  if (points.length === 0) {
    return { centerX: 0, centerY: 0, sizeX: 30, sizeY: 30 };
  }
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return {
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
    sizeX: Math.max(1, maxX - minX),
    sizeY: Math.max(1, maxY - minY),
  };
}

export function SliceViewer({
  file,
  gcode,
  status,
  rotation,
  onOrientationChange,
}: SliceViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [layerIndex, setLayerIndex] = useState(0);
  const [showInfo, setShowInfo] = useState(true);
  const [orientationMode, setOrientationMode] = useState(false);
  const layers = useMemo(() => (gcode ? parseGcodeLayers(gcode) : []), [gcode]);
  const reportedTotal = useMemo(
    () => (gcode ? layerTotalFromGcode(gcode) : null),
    [gcode],
  );
  const safeLayerIndex = Math.min(layerIndex, Math.max(0, layers.length - 1));
  const activeLayer = layers[safeLayerIndex] ?? null;
  const visibleLayers = useMemo(
    () => layers.slice(0, safeLayerIndex + 1),
    [layers, safeLayerIndex],
  );
  const stats = useMemo(() => lineStats(layers), [layers]);
  const codePreview = useMemo(
    () => gcodePreviewLines(gcode, activeLayer?.index ?? safeLayerIndex),
    [activeLayer?.index, gcode, safeLayerIndex],
  );
  const totalPathMm = stats.reduce((sum, stat) => sum + stat.lengthMm, 0);
  const hasRenderableSlice = gcode !== null && layers.length > 0;
  const hasRenderableScene = hasRenderableSlice || file !== null;

  useEffect(() => {
    let cancelled = false;
    let frameId = 0;
    let cleanup = () => {};

    async function renderScene() {
      const canvas = canvasRef.current;
      if (!canvas || !hasRenderableScene) return;

      const THREE = await import("three");
      const { OrbitControls } =
        await import("three/examples/jsm/controls/OrbitControls.js");
      const { STLLoader } = await import("three/examples/jsm/loaders/STLLoader.js");
      if (cancelled) return;

      const renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: true,
      });
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 1000);
      const controls = new OrbitControls(camera, renderer.domElement);
      const bounds = modelBounds(layers);
      const bedSize = Math.max(
        80,
        Math.ceil(Math.max(bounds.sizeX, bounds.sizeY) / 10) * 20,
      );
      const disposables: Array<{ dispose: () => void }> = [];

      const bedGeometry = new THREE.PlaneGeometry(bedSize, bedSize);
      const bedMaterial = new THREE.MeshBasicMaterial({
        color: 0x2b3033,
        transparent: true,
        opacity: 0.86,
        side: THREE.DoubleSide,
      });
      const bed = new THREE.Mesh(bedGeometry, bedMaterial);
      bed.rotation.x = -Math.PI / 2;
      scene.add(bed);
      disposables.push(bedGeometry, bedMaterial);

      const grid = new THREE.GridHelper(
        bedSize,
        Math.max(8, bedSize / 4),
        0x7a858e,
        0x4b5560,
      );
      grid.position.y = 0.01;
      scene.add(grid);
      disposables.push(grid.geometry, grid.material);

      let modelMesh: import("three").Mesh | null = null;
      if (file) {
        const stlBuffer = await file.arrayBuffer();
        if (cancelled) return;
        const geometry = new STLLoader().parse(stlBuffer);
        geometry.computeVertexNormals();
        geometry.computeBoundingBox();
        const box = geometry.boundingBox;
        const center = new THREE.Vector3();
        const size = new THREE.Vector3();
        box?.getCenter(center);
        box?.getSize(size);
        geometry.translate(-center.x, -center.y, -(box?.min.z ?? 0));
        const material = new THREE.MeshStandardMaterial({
          color: 0x9cc7d6,
          metalness: 0.08,
          roughness: 0.72,
          transparent: true,
          opacity: hasRenderableSlice ? 0.24 : 0.82,
        });
        modelMesh = new THREE.Mesh(geometry, material);
        modelMesh.rotation.x = -Math.PI / 2;
        if (rotation) {
          modelMesh.quaternion.multiply(
            new THREE.Quaternion(rotation[0], rotation[1], rotation[2], rotation[3]),
          );
        }
        scene.add(modelMesh);
        disposables.push(geometry, material);
      }

      function appendPositions(positions: number[], segments: GcodeSegment[]) {
        for (const segment of segments) {
          positions.push(
            segment.from.x - bounds.centerX,
            segment.from.z + 0.04,
            segment.from.y - bounds.centerY,
          );
          positions.push(
            segment.to.x - bounds.centerX,
            segment.to.z + 0.04,
            segment.to.y - bounds.centerY,
          );
        }
      }

      function addLines(
        selectedLayers: GcodeLayer[],
        type: GcodeLineType,
        color: number,
        opacity: number,
      ) {
        const positions: number[] = [];
        for (const layer of selectedLayers) {
          appendPositions(
            positions,
            layer.segments.filter((segment) => segment.type === type),
          );
        }
        if (positions.length === 0) return;
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute(
          "position",
          new THREE.Float32BufferAttribute(positions, 3),
        );
        const material = new THREE.LineBasicMaterial({
          color,
          transparent: opacity < 1,
          opacity,
        });
        scene.add(new THREE.LineSegments(geometry, material));
        disposables.push(geometry, material);
      }

      const previousLayers = visibleLayers.slice(0, -1);
      if (activeLayer) {
        for (const type of LINE_TYPES) {
          addLines(previousLayers, type.id, type.color, 0.22);
          addLines([activeLayer], type.id, type.color, 1);
        }
      }

      if (activeLayer) {
        const layerPlaneGeometry = new THREE.PlaneGeometry(
          Math.max(1, bounds.sizeX + 4),
          Math.max(1, bounds.sizeY + 4),
        );
        const layerPlaneMaterial = new THREE.MeshBasicMaterial({
          color: 0xfff2a6,
          transparent: true,
          opacity: 0.045,
          side: THREE.DoubleSide,
        });
        const layerPlane = new THREE.Mesh(layerPlaneGeometry, layerPlaneMaterial);
        layerPlane.rotation.x = -Math.PI / 2;
        layerPlane.position.y = activeLayer.z;
        scene.add(layerPlane);
        disposables.push(layerPlaneGeometry, layerPlaneMaterial);
      }

      scene.add(new THREE.AmbientLight(0xffffff, 0.78));
      const keyLight = new THREE.DirectionalLight(0xffffff, 0.85);
      keyLight.position.set(0, 40, 35);
      scene.add(keyLight);

      const span = Math.max(bounds.sizeX, bounds.sizeY, 40);
      camera.position.set(span * 0.95, span * 0.85, span * 1.35);
      controls.enableDamping = true;
      controls.target.set(0, (activeLayer?.z ?? 0) * 0.38, 0);
      controls.update();

      function resize() {
        const rect = renderer.domElement.getBoundingClientRect();
        const width = Math.max(1, Math.floor(rect.width));
        const height = Math.max(1, Math.floor(rect.height));
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      }

      function animate() {
        resize();
        controls.update();
        renderer.render(scene, camera);
        frameId = window.requestAnimationFrame(animate);
      }

      function chooseFace(event: PointerEvent) {
        if (!orientationMode || !modelMesh) return;
        const rect = renderer.domElement.getBoundingClientRect();
        const pointer = new THREE.Vector2(
          ((event.clientX - rect.left) / rect.width) * 2 - 1,
          -((event.clientY - rect.top) / rect.height) * 2 + 1,
        );
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(pointer, camera);
        const hit = raycaster.intersectObject(modelMesh, false)[0];
        if (!hit?.face) return;
        const normal = hit.face.normal.clone().normalize();
        const quaternion = new THREE.Quaternion().setFromUnitVectors(
          normal,
          new THREE.Vector3(0, 0, -1),
        );
        onOrientationChange([quaternion.x, quaternion.y, quaternion.z, quaternion.w]);
        setOrientationMode(false);
      }

      animate();
      renderer.domElement.addEventListener("pointerdown", chooseFace);
      cleanup = () => {
        renderer.domElement.removeEventListener("pointerdown", chooseFace);
        window.cancelAnimationFrame(frameId);
        controls.dispose();
        for (const disposable of disposables) disposable.dispose();
        renderer.dispose();
      };
    }

    renderScene();

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [
    activeLayer,
    file,
    hasRenderableScene,
    hasRenderableSlice,
    layers,
    onOrientationChange,
    orientationMode,
    rotation,
    visibleLayers,
  ]);

  return (
    <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-[var(--color-text)]">
            Slice Preview
          </h2>
          <p className="mt-1 text-xs font-mono text-[var(--color-muted)]">
            {activeLayer
              ? `Layer ${safeLayerIndex + 1}/${layers.length} · Z ${activeLayer.z.toFixed(2)} mm`
              : status === "failed"
                ? "Slice failed"
                : "Waiting for a successful slice"}
          </p>
        </div>
        <span className="rounded-md bg-white/5 px-2.5 py-1 text-xs font-mono text-[var(--color-muted)]">
          {reportedTotal ? `${reportedTotal} reported` : "no layers"}
        </span>
      </div>
      {file && (
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setOrientationMode((current) => !current)}
            className="rounded-lg border border-[var(--color-border-2)] px-3 py-2 text-xs font-semibold text-[var(--color-text)] transition-colors hover:border-[var(--color-teal)]"
          >
            This side down
          </button>
          <button
            type="button"
            onClick={() => onOrientationChange(null)}
            className="rounded-lg border border-[var(--color-border-2)] px-3 py-2 text-xs font-semibold text-[var(--color-text)] transition-colors hover:border-[var(--color-teal)]"
          >
            Reset
          </button>
          <span className="self-center font-mono text-xs text-[var(--color-muted)]">
            {rotation ? "custom orientation" : "uploaded orientation"}
          </span>
        </div>
      )}

      <div className="mt-4">
        <div className="relative min-h-[620px] overflow-hidden rounded-lg border border-[var(--color-border)] bg-[#111927]">
          {hasRenderableScene ? (
            <>
              <canvas ref={canvasRef} className="h-full min-h-[620px] w-full" />

              {hasRenderableSlice && (
                <button
                  type="button"
                  onClick={() => setShowInfo((current) => !current)}
                  className="absolute right-24 top-5 rounded-lg border border-white/15 bg-black/60 px-3 py-2 text-xs font-semibold text-white shadow-xl backdrop-blur transition-colors hover:border-[var(--color-teal)]"
                >
                  {showInfo ? "Hide Info" : "Show Info"}
                </button>
              )}

              {hasRenderableSlice && (
                <div className="absolute bottom-5 right-5 top-5 flex w-14 flex-col items-center justify-between rounded-lg border border-white/15 bg-black/55 px-2 py-3 backdrop-blur">
                <span className="text-[10px] uppercase tracking-wider text-white/70">
                  {layers.length}
                </span>
                <input
                  aria-label="Layer"
                  type="range"
                  min={0}
                  max={Math.max(0, layers.length - 1)}
                  value={safeLayerIndex}
                  disabled={layers.length === 0}
                  onChange={(event) =>
                    setLayerIndex(Number(event.target.value))
                  }
                  className="h-80 w-8 accent-[var(--color-teal)] [direction:rtl] [writing-mode:vertical-lr]"
                />
                <span className="rounded bg-white/90 px-1.5 py-0.5 font-mono text-xs text-black">
                  {safeLayerIndex + 1}
                </span>
                </div>
              )}

              {showInfo && hasRenderableSlice && (
                <>
                  <div className="absolute right-24 top-16 w-[300px] rounded-lg border border-white/10 bg-black/55 p-4 text-sm text-white shadow-xl backdrop-blur">
                    <div className="grid grid-cols-[1fr_52px_42px_58px] gap-2 border-b border-white/20 pb-2 text-xs font-semibold text-white/80">
                      <span>Line Type</span>
                      <span>Time</span>
                      <span>%</span>
                      <span>Usage</span>
                    </div>
                    <div className="mt-2 flex flex-col gap-1.5">
                      {stats.map((stat) => (
                        <div
                          key={stat.id}
                          className="grid grid-cols-[1fr_52px_42px_58px] gap-2 text-xs text-white/85"
                        >
                          <span className="flex items-center gap-2">
                            <span
                              className="h-2.5 w-2.5 rounded-sm"
                              style={{ backgroundColor: stat.swatch }}
                            />
                            {stat.label}
                          </span>
                          <span>{formatDuration(stat.seconds)}</span>
                          <span>{stat.pct.toFixed(1)}</span>
                          <span>{(stat.lengthMm / 1000).toFixed(2)}m</span>
                        </div>
                      ))}
                    </div>

                    <div className="mt-4 border-t border-white/20 pt-3 text-xs text-white/80">
                      <p className="font-semibold text-white">
                        Total estimation
                      </p>
                      <div className="mt-2 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
                        <span>Total pellet path</span>
                        <span>{(totalPathMm / 1000).toFixed(2)} m</span>
                        <span>Model printing time</span>
                        <span>
                          {formatDuration(
                            stats.reduce((sum, stat) => sum + stat.seconds, 0),
                          )}
                        </span>
                        <span>Current layer</span>
                        <span>{activeLayer?.index ?? 0}</span>
                      </div>
                    </div>
                  </div>

                  <div className="absolute bottom-20 right-24 w-[300px] rounded-lg border border-white/10 bg-black/55 p-3 font-mono text-xs text-white/80 shadow-xl backdrop-blur">
                    {codePreview.map((line) => (
                      <div
                        key={line}
                        className={
                          line.includes(";LAYER") || line.includes(";TYPE")
                            ? "text-[var(--color-teal)]"
                            : line.includes("G1")
                              ? "text-[#ffde59]"
                              : "text-white/60"
                        }
                      >
                        {line}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          ) : (
            <div className="flex min-h-[620px] items-center justify-center px-6 text-center text-sm text-[var(--color-muted)]">
              {status === "failed"
                ? "No preview is available for this failed slice."
                : "Slice an STL to preview line types, layers, and G-code."}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
