import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "coverage/**",
    ".core-tests/**",
    ".worker-tests/**",
    "work/**",
    "src/app/.well-known/workflow/**",
    "next-env.d.ts",
  ]),
]);
