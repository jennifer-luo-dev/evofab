import "@testing-library/jest-dom/vitest";
import { afterAll, afterEach, beforeAll } from "vitest";
import { server } from "./support/msw-server";

beforeAll(() =>
  server.listen({
    onUnhandledRequest(request, print) {
      if (["7137", "54321"].includes(new URL(request.url).port)) return;
      print.error();
    },
  }),
);
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
