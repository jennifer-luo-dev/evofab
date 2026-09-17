import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Python virtualenv for the Orbbec camera bridge (see
    // app/api/python/camera_orbbec_service.py) — vendors ~1GB of packages,
    // including bundled JS assets from Jupyter/Plotly, that aren't part of
    // this project's source and are large enough to exhaust the linter's
    // heap if not excluded.
    "app/api/python/orbbec_env/**",
    "app/api/python/.pytest_cache/**",
  ]),
]);

export default eslintConfig;
