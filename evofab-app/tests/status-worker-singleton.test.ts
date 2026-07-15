import assert from "node:assert/strict";
import test from "node:test";
import type { AddressInfo } from "node:net";
import {
  acquireStatusWorkerSingleton,
  DEFAULT_STATUS_WORKER_SINGLETON_PORT,
  readStatusWorkerSingletonPort,
} from "../app/lib/status-worker-singleton";

test("status worker singleton rejects a second process owner", async () => {
  const first = await acquireStatusWorkerSingleton(0);
  assert.ok(first);
  const port = (first.address() as AddressInfo).port;
  try {
    assert.equal(await acquireStatusWorkerSingleton(port), null);
  } finally {
    await new Promise<void>((resolve, reject) =>
      first.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test("status worker singleton port falls back for invalid configuration", () => {
  const previous = process.env.STATUS_WORKER_SINGLETON_PORT;
  try {
    process.env.STATUS_WORKER_SINGLETON_PORT = "invalid";
    assert.equal(
      readStatusWorkerSingletonPort(),
      DEFAULT_STATUS_WORKER_SINGLETON_PORT,
    );
    process.env.STATUS_WORKER_SINGLETON_PORT = "0";
    assert.equal(
      readStatusWorkerSingletonPort(),
      DEFAULT_STATUS_WORKER_SINGLETON_PORT,
    );
  } finally {
    if (previous === undefined) delete process.env.STATUS_WORKER_SINGLETON_PORT;
    else process.env.STATUS_WORKER_SINGLETON_PORT = previous;
  }
});
