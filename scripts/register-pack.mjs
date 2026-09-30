import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { validatePackManifest } from "../.core-tests/packs/registry.js";
import { resolvePackDependencies } from "../.core-tests/packs/dependencies.js";

const [source,output,catalog]=process.argv.slice(2);
if (!source||!output) throw new Error("Usage: node scripts/register-pack.mjs manifests.json migration.sql [existing-catalog.json]. Run npm run pretest first.");
const read=(path)=>{const value=JSON.parse(readFileSync(path,"utf8"));return Array.isArray(value)?value:[value];};
const manifests=read(source), all=[...(catalog?read(catalog):[]),...manifests];
const unique=new Map();
for (const manifest of all) {
  validatePackManifest(manifest);
  const key=`${manifest.packKey}@${manifest.version}`,prior=unique.get(key);
  if (prior&&JSON.stringify(prior)!==JSON.stringify(manifest)) throw new Error(`Conflicting catalog entry: ${key}`);
  unique.set(key,manifest);
}
const releases=[...unique.values()].map(manifest=>({id:randomUUID(),status:"experimental",manifest}));
for (const manifest of manifests) resolvePackDependencies(releases,{packKey:manifest.packKey,version:manifest.version},true);
const sql=manifests.map(m=>`select private.stage10_register_pack('${JSON.stringify(m).replaceAll("'","''")}'::jsonb);`).join("\n\n");
writeFileSync(output,`-- Validated declarative packs. Registration remains experimental until platform evaluation passes.\n${sql}\n`);
console.log(`Validated ${manifests.length} releases and wrote ${output}.`);
