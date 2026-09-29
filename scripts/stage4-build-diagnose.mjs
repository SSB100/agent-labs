import { rm, writeFile, mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const quality = spawnSync("npm", ["run", "quality"], {
  encoding: "utf8",
  env: process.env,
  shell: process.platform === "win32",
});
const build = spawnSync("npx", ["next", "build"], {
  encoding: "utf8",
  env: process.env,
  shell: process.platform === "win32",
});

await mkdir("public", { recursive: true });
await writeFile(
  "public/stage4-build-diagnostics.txt",
  [
    `=== quality ===\nexit: ${quality.status ?? "unknown"}\n${quality.stdout ?? ""}\n${quality.stderr ?? ""}`,
    `=== workflow next build ===\nexit: ${build.status ?? "unknown"}\n${build.stdout ?? ""}\n${build.stderr ?? ""}`,
  ].join("\n\n"),
  "utf8",
);

await rm(".next", { recursive: true, force: true });
await writeFile(
  "next.config.ts",
  'import type { NextConfig } from "next";\nconst nextConfig: NextConfig = { poweredByHeader: false, reactStrictMode: true };\nexport default nextConfig;\n',
  "utf8",
);
