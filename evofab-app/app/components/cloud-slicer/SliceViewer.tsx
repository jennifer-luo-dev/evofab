"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  layerTotalFromGcode,
  parseGcodeLayers,
} from "@/app/lib/gcode-layer-parser";

interface SliceViewerProps {
  file: File | null;
  gcode: string | null;
  status: string;
}

export function SliceViewer({ file, gcode, status }: SliceViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [layerIndex, setLayerIndex] = useState(0);
  const layers = useMemo(() => (gcode ? parseGcodeLayers(gcode) : []), [gcode]);
  const reportedTotal = useMemo(
    () => (gcode ? layerTotalFromGcode(gcode) : null),
    [gcode],
  );
  const safeLayerIndex = Math.min(layerIndex, Math.max(0, layers.length - 1));
  const activeLayer = layers[safeLayerIndex] ?? null;
  const hasRenderableSlice =
    file !== null && gcode !== null && layers.length > 0;

  useEffect(() => {
    let cancelled = false;
    let frameId = 0;
    let cleanup = () => {};

    async function renderScene() {
      const canvas = canvasRef.current;
      if (!canvas || !file || !activeLayer) return;

      const THREE = await import("three");
      const { STLLoader } =
        await import("three/examples/jsm/loaders/STLLoader.js");
      const { OrbitControls } =
        await import("three/examples/jsm/controls/OrbitControls.js");
      if (cancelled) return;

      const renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: true,
      });
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
      const controls = new OrbitControls(camera, renderer.domElement);
      const stlBuffer = await file.arrayBuffer();
      if (cancelled) {
        renderer.dispose();
        return;
      }

      const geometry = new STLLoader().parse(stlBuffer);
      geometry.computeVertexNormals();
      geometry.computeBoundingBox();
      const box = geometry.boundingBox;
      const center = new THREE.Vector3();
      const size = new THREE.Vector3();
      if (box) {
        box.getCenter(center);
        box.getSize(size);
        geometry.translate(-center.x, -center.y, -center.z);
      }

      const partMaterial = new THREE.MeshStandardMaterial({
        color: 0x6fd7d2,
        roughness: 0.55,
        metalness: 0.05,
        transparent: true,
        opacity: 0.32,
      });
      const partMesh = new THREE.Mesh(geometry, partMaterial);
      scene.add(partMesh);

      const positions: number[] = [];
      for (const segment of activeLayer.segments) {
        positions.push(
          segment.from.x - 12,
          segment.from.z,
          segment.from.y - 12,
        );
        positions.push(segment.to.x - 12, segment.to.z, segment.to.y - 12);
      }
      const layerGeometry = new THREE.BufferGeometry();
      layerGeometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(positions, 3),
      );
      const layerLines = new THREE.LineSegments(
        layerGeometry,
        new THREE.LineBasicMaterial({ color: 0xffc857 }),
      );
      scene.add(layerLines);

      scene.add(new THREE.AmbientLight(0xffffff, 0.7));
      const keyLight = new THREE.DirectionalLight(0xffffff, 1.2);
      keyLight.position.set(35, 50, 45);
      scene.add(keyLight);

      const maxSize = Math.max(size.x || 30, size.y || 30, size.z || 30, 30);
      camera.position.set(maxSize * 1.2, maxSize * 1.1, maxSize * 1.6);
      controls.enableDamping = true;
      controls.target.set(0, 0, 0);
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
        geometry.dispose();
        layerGeometry.dispose();
        partMaterial.dispose();
        renderer.dispose();
      };
    }

    renderScene();

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [activeLayer, file]);

  return (
    <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-[var(--color-text)]">
            Part And Layer View
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

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_120px]">
        <div className="relative min-h-[360px] overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)]">
          {hasRenderableSlice ? (
            <canvas ref={canvasRef} className="h-full min-h-[360px] w-full" />
          ) : (
            <div className="flex min-h-[360px] items-center justify-center px-6 text-center text-sm text-[var(--color-muted)]">
              {status === "failed"
                ? "No preview is available for this failed slice."
                : "Slice an STL to preview the part and scrub generated toolpaths."}
            </div>
          )}
        </div>

        <div className="flex min-h-[360px] flex-col items-center justify-between rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3">
          <span className="text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
            Layer
          </span>
          <input
            aria-label="Layer"
            type="range"
            min={0}
            max={Math.max(0, layers.length - 1)}
            value={safeLayerIndex}
            disabled={layers.length === 0}
            onChange={(event) => setLayerIndex(Number(event.target.value))}
            className="h-60 w-8 [writing-mode:vertical-rl]"
          />
          <span className="font-mono text-xs text-[var(--color-text)]">
            {layers.length ? safeLayerIndex + 1 : 0}/{layers.length}
          </span>
        </div>
      </div>
    </section>
  );
}
