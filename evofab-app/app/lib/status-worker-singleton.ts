import { createServer, type Server } from "node:net";

export const DEFAULT_STATUS_WORKER_SINGLETON_PORT = 32_147;

export function readStatusWorkerSingletonPort(): number {
  const value = Number(
    process.env.STATUS_WORKER_SINGLETON_PORT ??
      DEFAULT_STATUS_WORKER_SINGLETON_PORT,
  );
  return Number.isInteger(value) && value > 0 && value <= 65_535
    ? value
    : DEFAULT_STATUS_WORKER_SINGLETON_PORT;
}

export async function acquireStatusWorkerSingleton(
  port = readStatusWorkerSingletonPort(),
): Promise<Server | null> {
  const server = createServer();
  return new Promise((resolve, reject) => {
    server.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE") {
        resolve(null);
        return;
      }
      reject(error);
    });
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}
