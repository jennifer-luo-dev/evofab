"use client";

import { useEffect, useRef } from "react";
import type { BoundingBoxMm } from "@/app/lib/slicer-client";
import type { SlicerFace } from "@/app/lib/slicer-client";
import type { BuildVolumeMm } from "@/app/lib/printability";

interface PrepareSceneProps {
  file: File;
  rotation: number[] | null;
  buildVolume: BuildVolumeMm | null;
  bounds: BoundingBoxMm | null;
  faces: SlicerFace[];
  onFacePick: (face: SlicerFace) => void;
}

export function PrepareScene({
  file,
  rotation,
  buildVolume,
  bounds,
  faces,
  onFacePick,
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
      mesh.rotation.x = -Math.PI / 2;
      if (rotation) {
        mesh.quaternion.multiply(
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

      const faceMeshes: Array<{
        face: SlicerFace;
        mesh: import("three").Mesh;
        material: import("three").MeshBasicMaterial;
      }> = [];
      const positions = geometry.getAttribute("position");
      for (const face of faces) {
        const facePositions: number[] = [];
        for (const triangleIndex of face.triangle_indices) {
          for (let vertexOffset = 0; vertexOffset < 3; vertexOffset += 1) {
            const sourceIndex = triangleIndex * 3 + vertexOffset;
            if (sourceIndex >= positions.count) continue;
            facePositions.push(
              positions.getX(sourceIndex),
              positions.getY(sourceIndex),
              positions.getZ(sourceIndex),
            );
          }
        }
        if (facePositions.length < 9) continue;
        const faceGeometry = new THREE.BufferGeometry();
        faceGeometry.setAttribute(
          "position",
          new THREE.Float32BufferAttribute(facePositions, 3),
        );
        faceGeometry.computeVertexNormals();
        const faceMaterial = new THREE.MeshBasicMaterial({
          color: face.rank === 1 ? 0x22c55e : 0x38bdf8,
          transparent: true,
          opacity: face.rank === 1 ? 0.32 : 0.18,
          side: THREE.DoubleSide,
          depthWrite: false,
        });
        const faceMesh = new THREE.Mesh(faceGeometry, faceMaterial);
        faceMesh.quaternion.copy(mesh.quaternion);
        faceMesh.position.copy(mesh.position);
        faceMesh.renderOrder = 2;
        scene.add(faceMesh);
        faceMeshes.push({ face, mesh: faceMesh, material: faceMaterial });
        disposables.push(faceGeometry, faceMaterial);
      }

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

      const pointer = new THREE.Vector2();
      const raycaster = new THREE.Raycaster();
      let hovered: (typeof faceMeshes)[number] | null = null;

      function pickFace(event: PointerEvent, commit: boolean) {
        if (faceMeshes.length === 0) return;
        const rect = renderer.domElement.getBoundingClientRect();
        pointer.set(
          ((event.clientX - rect.left) / rect.width) * 2 - 1,
          -((event.clientY - rect.top) / rect.height) * 2 + 1,
        );
        raycaster.setFromCamera(pointer, camera);
        const hit = raycaster.intersectObjects(
          faceMeshes.map((item) => item.mesh),
          false,
        )[0];
        const nextHovered =
          faceMeshes.find((item) => item.mesh === hit?.object) ?? null;
        if (hovered !== nextHovered) {
          if (hovered)
            hovered.material.opacity = hovered.face.rank === 1 ? 0.32 : 0.18;
          hovered = nextHovered;
          if (hovered) hovered.material.opacity = 0.55;
        }
        if (commit && nextHovered) onFacePick(nextHovered.face);
      }

      function handlePointerMove(event: PointerEvent) {
        pickFace(event, false);
      }

      function handlePointerDown(event: PointerEvent) {
        pickFace(event, true);
      }

      animate();
      renderer.domElement.addEventListener("pointermove", handlePointerMove);
      renderer.domElement.addEventListener("pointerdown", handlePointerDown);
      cleanup = () => {
        window.cancelAnimationFrame(frameId);
        renderer.domElement.removeEventListener(
          "pointermove",
          handlePointerMove,
        );
        renderer.domElement.removeEventListener(
          "pointerdown",
          handlePointerDown,
        );
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
  }, [bounds, buildVolume, faces, file, onFacePick, rotation]);

  return (
    <canvas
      ref={canvasRef}
      aria-label="Uploaded STL on build plate"
      className="h-full min-h-[360px] w-full"
    />
  );
}
