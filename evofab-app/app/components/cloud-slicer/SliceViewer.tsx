"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  layerTotalFromGcode,
  type GcodeLayer,
  type GcodeLineType,
  type GcodeSegment,
} from "@/app/lib/gcode-layer-parser";
import { GCODE_PREVIEW_TUBE_OPTIONS } from "@/app/lib/gcode-preview-adapter";
import type { BuildVolumeMm } from "@/app/lib/printability";
import { phaseJPreviewAdapter } from "./preview-adapter";

interface SliceViewerProps {
  file: File | null;
  gcode: string | null;
  status: string;
  rotation: number[] | null;
  buildVolume: BuildVolumeMm;
  reportedLayerCount: number | null;
}

const LINE_TYPES: Array<{
  id: GcodeLineType;
  label: string;
  color: number;
  swatch: string;
}> = [
  {
    id: "external_perimeter",
    label: "External perimeter",
    color: 0xff8a3d,
    swatch: "#ff8a3d",
  },
  { id: "perimeter", label: "Perimeter", color: 0xffb347, swatch: "#ffb347" },
  { id: "outer_wall", label: "Outer wall", color: 0xff8a3d, swatch: "#ff8a3d" },
  { id: "inner_wall", label: "Inner wall", color: 0xffde59, swatch: "#ffde59" },
  { id: "infill", label: "Infill", color: 0xc53030, swatch: "#c53030" },
  {
    id: "sparse_infill",
    label: "Sparse infill",
    color: 0xc53030,
    swatch: "#c53030",
  },
  { id: "support", label: "Support", color: 0x22c55e, swatch: "#22c55e" },
  {
    id: "top_surface",
    label: "Top surface",
    color: 0xff4141,
    swatch: "#ff4141",
  },
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
      if (segment.type === "travel") continue;
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
  let implicitLayer = -1;
  const marker = lines.findIndex((line) => {
    if (new RegExp(`^;\\s*LAYER[:_]\\s*${layerIndex}\\b`, "i").test(line)) {
      return true;
    }
    if (/^;\s*LAYER_CHANGE\b/i.test(line)) {
      implicitLayer += 1;
      return implicitLayer === layerIndex;
    }
    return false;
  });
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
    return { centerX: 0, centerY: 0, minZ: 0, maxZ: 30, sizeX: 30, sizeY: 30 };
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
    minZ: Math.min(...points.map((point) => point.z)),
    maxZ: Math.max(...points.map((point) => point.z)),
    sizeX: Math.max(1, maxX - minX),
    sizeY: Math.max(1, maxY - minY),
  };
}

export function SliceViewer({
  file,
  gcode,
  status,
  rotation,
  buildVolume,
  reportedLayerCount,
}: SliceViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [layerProgress, setLayerProgress] = useState(100);
  const [showInfo, setShowInfo] = useState(true);
  const layers = useMemo(
    () => (gcode ? phaseJPreviewAdapter.parse(gcode) : []),
    [gcode],
  );
  const reportedTotal = useMemo(
    () => reportedLayerCount ?? (gcode ? layerTotalFromGcode(gcode) : null),
    [gcode, reportedLayerCount],
  );
  const safeLayerIndex = Math.max(0, layers.length - 1);
  const activeLayer = layers[safeLayerIndex] ?? null;
  const visibleLayers = useMemo(
    () => layers.slice(0, safeLayerIndex + 1),
    [layers, safeLayerIndex],
  );
  const activeLayerSegments = useMemo(
    () =>
      activeLayer
        ? activeLayer.segments.slice(
            0,
            Math.ceil(activeLayer.segments.length * (layerProgress / 100)),
          )
        : [],
    [activeLayer, layerProgress],
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
      const { STLLoader } =
        await import("three/examples/jsm/loaders/STLLoader.js");
      if (cancelled) return;

      const renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: true,
      });
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 5000);
      const controls = new OrbitControls(camera, renderer.domElement);
      const bounds = modelBounds(layers);
      const bedX = buildVolume.x;
      const bedY = buildVolume.y;
      const disposables: Array<{ dispose: () => void }> = [];

      const bedGeometry = new THREE.PlaneGeometry(bedX, bedY);
      const bedMaterial = new THREE.MeshBasicMaterial({
        color: 0x2b3033,
        transparent: true,
        opacity: 0.72,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      });
      const bed = new THREE.Mesh(bedGeometry, bedMaterial);
      bed.rotation.x = -Math.PI / 2;
      scene.add(bed);
      disposables.push(bedGeometry, bedMaterial);

      const gridSpacing = Math.max(bedX, bedY) > 500 ? 50 : 20;
      const gridVertices: number[] = [];
      for (let x = -bedX / 2; x <= bedX / 2 + 0.001; x += gridSpacing) {
        gridVertices.push(x, 0.12, -bedY / 2, x, 0.12, bedY / 2);
      }
      for (let z = -bedY / 2; z <= bedY / 2 + 0.001; z += gridSpacing) {
        gridVertices.push(-bedX / 2, 0.12, z, bedX / 2, 0.12, z);
      }
      const gridGeometry = new THREE.BufferGeometry();
      gridGeometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(gridVertices, 3),
      );
      const gridMaterial = new THREE.LineBasicMaterial({
        color: 0x323b43,
        transparent: true,
        opacity: 0.68,
      });
      const grid = new THREE.LineSegments(gridGeometry, gridMaterial);
      scene.add(grid);
      disposables.push(gridGeometry, gridMaterial);

      if (file && !hasRenderableSlice) {
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
        const modelMesh = new THREE.Mesh(geometry, material);
        modelMesh.rotation.x = -Math.PI / 2;
        if (rotation) {
          modelMesh.quaternion.multiply(
            new THREE.Quaternion(
              rotation[0],
              rotation[1],
              rotation[2],
              rotation[3],
            ),
          );
        }
        scene.add(modelMesh);
        disposables.push(geometry, material);
      }

      function pointFromGcode(point: GcodeSegment["from"]) {
        return new THREE.Vector3(
          point.x - bounds.centerX,
          point.z + 0.04,
          point.y - bounds.centerY,
        );
      }

      function addTubeSegment(
        segment: GcodeSegment,
        material: import("three").Material,
        radius: number,
      ) {
        const from = pointFromGcode(segment.from);
        const to = pointFromGcode(segment.to);
        const delta = new THREE.Vector3().subVectors(to, from);
        const length = delta.length();
        if (length <= 0.001) return;
        const geometry = new THREE.CylinderGeometry(radius, radius, length, 8);
        const tube = new THREE.Mesh(geometry, material);
        tube.position.copy(from).addScaledVector(delta, 0.5);
        tube.quaternion.setFromUnitVectors(
          new THREE.Vector3(0, 1, 0),
          delta.normalize(),
        );
        scene.add(tube);
        disposables.push(geometry);
      }

      function addTubes(
        selectedLayers: GcodeLayer[],
        type: GcodeLineType,
        color: number,
        opacity: number,
      ) {
        if (type === "travel") return;
        const material = new THREE.MeshBasicMaterial({
          color,
          transparent: opacity < 1,
          opacity,
        });
        disposables.push(material);
        const radius = GCODE_PREVIEW_TUBE_OPTIONS.renderTubes ? 0.22 : 0.12;
        for (const layer of selectedLayers) {
          for (const segment of layer.segments.filter(
            (item) => item.type === type,
          )) {
            addTubeSegment(segment, material, radius);
          }
        }
      }

      const previousLayers = visibleLayers.slice(0, -1);
      phaseJPreviewAdapter.render();
      if (activeLayer) {
        for (const type of LINE_TYPES) {
          addTubes(previousLayers, type.id, type.color, 0.22);
          addTubes(
            [{ ...activeLayer, segments: activeLayerSegments }],
            type.id,
            type.color,
            1,
          );
        }
      }

      scene.add(new THREE.AmbientLight(0xffffff, 0.78));
      const keyLight = new THREE.DirectionalLight(0xffffff, 0.85);
      keyLight.position.set(0, 40, 35);
      scene.add(keyLight);

      const height = Math.max(1, bounds.maxZ - bounds.minZ);
      const target = new THREE.Vector3(0, height * 0.45, 0);
      const fitWidth = Math.max(bounds.sizeX, 20);
      const fitDepth = Math.max(bounds.sizeY, 20);
      const fitHeight = Math.max(height, 12);
      const fitRadius =
        Math.sqrt(fitWidth * fitWidth + fitDepth * fitDepth) * 0.5;
      const distance = Math.max(
        45,
        (Math.max(fitRadius, fitHeight) * 1.12) /
          Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5)),
      );
      camera.position.copy(
        target
          .clone()
          .add(new THREE.Vector3(distance * 0.48, distance * 0.68, distance)),
      );
      controls.enableDamping = true;
      controls.enablePan = true;
      controls.minDistance = distance * 0.2;
      controls.maxDistance = distance * 3;
      controls.target.copy(target);
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

      animate();
      cleanup = () => {
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
    buildVolume.x,
    buildVolume.y,
    file,
    hasRenderableScene,
    hasRenderableSlice,
    layers,
    rotation,
    activeLayerSegments,
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
      {hasRenderableSlice && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label className="flex min-w-56 flex-1 items-center gap-2 text-xs text-[var(--color-muted)]">
            <span>Layer progress</span>
            <input
              aria-label="Within-layer progress"
              type="range"
              min={1}
              max={100}
              value={layerProgress}
              onChange={(event) => setLayerProgress(Number(event.target.value))}
              className="flex-1 accent-[var(--color-teal)]"
            />
            <span className="font-mono">{layerProgress}%</span>
          </label>
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
                  className="absolute right-5 top-5 rounded-lg border border-white/15 bg-black/60 px-3 py-2 text-xs font-semibold text-white shadow-xl backdrop-blur transition-colors hover:border-[var(--color-teal)]"
                >
                  {showInfo ? "Hide Info" : "Show Info"}
                </button>
              )}

              {showInfo && hasRenderableSlice && (
                <>
                  <div className="absolute right-5 top-16 w-[300px] rounded-lg border border-white/10 bg-black/55 p-4 text-sm text-white shadow-xl backdrop-blur">
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

                  <div className="absolute bottom-5 right-5 w-[300px] rounded-lg border border-white/10 bg-black/55 p-3 font-mono text-xs text-white/80 shadow-xl backdrop-blur">
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
