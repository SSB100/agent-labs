import { mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const commands = [
  ["lint", ["run", "lint"]],
  ["typecheck", ["run", "typecheck"]],
  ["test", ["test"]],
];

const sections = [];
for (const [name, args] of commands) {
  const result = spawnSync("npm", args, {
    encoding: "utf8",
    env: process.env,
    shell: process.platform === "win32",
  });
  sections.push(
    `=== ${name} ===\nexit: ${result.status ?? "unknown"}\n\n${result.stdout ?? ""}\n${result.stderr ?? ""}`,
  );
}

await mkdir("public", { recursive: true });
await writeFile("public/stage4-diagnostics.txt", `${sections.join("\n\n")}\n`, "utf8");
