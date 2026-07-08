import { SlicerError } from "./slicer-errors";

export type SlicerMode = "mock" | "real";

export function getSlicerMode(
  env: NodeJS.ProcessEnv = process.env,
): SlicerMode {
  return env.SLICER_MODE === "real" || env.SLICER_MODE === "mock"
    ? env.SLICER_MODE
    : "mock";
}

export function resolveSlicerConfig(env: NodeJS.ProcessEnv = process.env): {
  mode: SlicerMode;
  token?: string;
  url?: string;
} {
  const mode = getSlicerMode(env);

  if (mode === "mock") {
    return { mode };
  }

  if (!env.SLICER_URL || !env.SLICER_TOKEN) {
    throw new SlicerError({
      code: "SLICER_UNCONFIGURED",
      message: "Real slicer mode requires SLICER_URL and SLICER_TOKEN.",
      retryable: false,
    });
  }

  return {
    mode,
    token: env.SLICER_TOKEN,
    url: env.SLICER_URL.replace(/\/+$/, ""),
  };
}
