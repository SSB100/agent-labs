import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const commands = [
  ["lint", ["run", "lint"]],
  ["typecheck", ["run", "typecheck"]],
  ["test", ["test"]],
];

const sections = [];
for (const [name, args] of commands) {
  let output = "";
  let exitCode = 0;
  try {
    output = execFileSync("npm", args, {
      encoding: "utf8",
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    exitCode = error.status ?? 1;
    output = `${error.stdout ?? ""}${error.stderr ?? ""}`;
  }
  sections.push(`=== ${name} ===\nexit: ${exitCode}\n\n${output}`);
}

mkdirSync("public", { recursive: true });
writeFileSync("public/stage5-diagnostics.txt", `${sections.join("\n\n")}\n`, "utf8");
