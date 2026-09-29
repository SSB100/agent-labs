import { createHash, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

const TOKEN_HASH =
  "c0b3c9b5662d22b3071e494bdd9411811ea7efa35a8bee6ebccaef1d3db82c30";

function authorized(token: string) {
  const supplied = createHash("sha256").update(token).digest();
  const expected = Buffer.from(TOKEN_HASH, "hex");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export async function GET(request: NextRequest) {
  if (
    process.env.VERCEL_ENV !== "preview" ||
    !authorized(request.nextUrl.searchParams.get("token") ?? "")
  ) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const publicDirectory = path.join(process.cwd(), "public");
  const read = async (fileName: string) => {
    try {
      return await readFile(path.join(publicDirectory, fileName), "utf8");
    } catch {
      return `${fileName} was not generated.`;
    }
  };
  const [lint, typecheck, tests] = await Promise.all([
    read("stage8-lint.txt"),
    read("stage8-typecheck.txt"),
    read("stage8-tests.txt"),
  ]);

  return Response.json({ lint, typecheck, tests });
}
