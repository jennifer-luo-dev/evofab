import assert from "node:assert/strict";
import test from "node:test";
import { preparationQuaternion } from "../app/lib/preparation-orientation";

test("preparation quaternion preserves identity orientation", () => {
  assert.deepEqual(preparationQuaternion([0, 0, 0, 1]), [0, 0, 0, 1]);
});

test("preparation quaternion preserves a non-identity source transform", () => {
  const rotation = [0, Math.SQRT1_2, 0, Math.SQRT1_2];
  assert.deepEqual(preparationQuaternion(rotation), rotation);
  assert.equal(preparationQuaternion([0, 0, 0]), null);
  assert.equal(preparationQuaternion([0, 0, Number.NaN, 1]), null);
});
