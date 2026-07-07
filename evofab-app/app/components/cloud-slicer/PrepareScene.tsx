"use client";

import { useEffect, useRef } from "react";
import type { BoundingBoxMm } from "@/app/lib/slicer-client";
import type { BuildVolumeMm } from "@/app/lib/printability";

interface PrepareSceneProps {
  file: File;
  rotation: number[] | null;
  buildVolume: BuildVolumeMm | null;
  bounds: BoundingBoxMm | null;
}

export function PrepareScene({
  file,
  rotation,
  buildVolume,
  bounds,
}: PrepareSceneProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    let frameId = 0;
    let cleanup = () => {};

    async function renderScene() {
      const canvas = canvasRef.current;
      if (!canvas) return;

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
      const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 2000);
      const controls = new OrbitControls(camera, renderer.domElement);
      const disposables: Array<{ dispose: () => void }> = [];

      const plateX = buildVolume?.x ?? Math.max(160, (bounds?.x ?? 80) + 60);
      const plateY = buildVolume?.y ?? Math.max(160, (bounds?.y ?? 80) + 60);
      const plateZ = buildVolume?.z ?? Math.max(120, (bounds?.z ?? 60) + 40);
      const plateSize = Math.max(plateX, plateY);

      const plateGeometry = new THREE.PlaneGeometry(plateX, plateY);
      const plateMaterial = new THREE.MeshStandardMaterial({
        color: 0x23292d,
        metalness: 0.08,
        roughness: 0.78,
        side: THREE.DoubleSide,
      });
      const plate = new THREE.Mesh(plateGeometry, plateMaterial);
      plate.rotation.x = -Math.PI / 2;
      scene.add(plate);
      disposables.push(plateGeometry, plateMaterial);

      const grid = new THREE.GridHelper(
        plateSize,
        Math.max(8, Math.round(plateSize / 20)),
        0x7f8a93,
        0x3f4850,
      );
      grid.position.y = 0.02;
      scene.add(grid);
      disposables.push(grid.geometry, grid.material);

      const volumeGeometry = new THREE.BoxGeometry(plateX, plateZ, plateY);
      const edges = new THREE.EdgesGeometry(volumeGeometry);
      const volumeMaterial = new THREE.LineBasicMaterial({
        color: 0x7dd3fc,
        transparent: true,
        opacity: 0.5,
      });
      const volume = new THREE.LineSegments(edges, volumeMaterial);
      volume.position.y = plateZ / 2;
      scene.add(volume);
      disposables.push(volumeGeometry, edges, volumeMaterial);

      const stlBuffer = await file.arrayBuffer();
      if (cancelled) return;
      const geometry = new STLLoader().parse(stlBuffer);
      geometry.computeVertexNormals();
      geometry.computeBoundingBox();
      const material = new THREE.MeshStandardMaterial({
        color: 0x9cc7d6,
        metalness: 0.06,
        roughness: 0.68,
      });
      const mesh = new THREE.Mesh(geometry, material);
      if (rotation) {
        mesh.quaternion.copy(
          new THREE.Quaternion(
            rotation[0],
            rotation[1],
            rotation[2],
            rotation[3],
          ),
        );
      }
      mesh.updateMatrixWorld(true);
      const modelBox = new THREE.Box3().setFromObject(mesh);
      const modelCenter = modelBox.getCenter(new THREE.Vector3());
      mesh.position.x -= modelCenter.x;
      mesh.position.z -= modelCenter.z;
      mesh.position.y -= modelBox.min.y;
      scene.add(mesh);
      disposables.push(geometry, material);

      scene.add(new THREE.AmbientLight(0xffffff, 0.72));
      const keyLight = new THREE.DirectionalLight(0xffffff, 0.9);
      keyLight.position.set(plateX * 0.3, plateZ * 1.1, plateY * 0.5);
      scene.add(keyLight);

      const span = Math.max(plateX, plateY, plateZ);
      camera.position.set(span * 0.62, span * 0.58, span * 0.78);
      controls.enableDamping = true;
      controls.target.set(0, Math.min(plateZ * 0.2, 50), 0);
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
  }, [bounds, buildVolume, file, rotation]);

  return (
    <canvas
      ref={canvasRef}
      aria-label="Uploaded STL on build plate"
      className="h-full min-h-[360px] w-full"
    />
  );
}
