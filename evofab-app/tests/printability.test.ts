import assert from "node:assert/strict";
import test from "node:test";
import { buildVolumeBlock, parseBuildVolume } from "../app/lib/printability";

test("parses build volume strings with x or multiplication separators", () => {
  assert.deepEqual(parseBuildVolume("300x300x400mm"), { x: 300, y: 300, z: 400 });
  assert.deepEqual(parseBuildVolume("152.4×152.4×152.4mm"), {
    x: 152.4,
    y: 152.4,
    z: 152.4,
  });
});

test("detects largest axis overage", () => {
  assert.deepEqual(
    buildVolumeBlock({ x: 260, y: 220, z: 410 }, { x: 250, y: 250, z: 400 }),
    { axis: "x", overageMm: 10 },
  );
  assert.equal(buildVolumeBlock({ x: 10, y: 20, z: 30 }, { x: 50, y: 50, z: 50 }), null);
});
