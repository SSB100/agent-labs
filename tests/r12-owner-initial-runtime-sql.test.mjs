import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { r04SqlBootstrap } from './helpers/r04-sql-bootstrap.mjs';
import { sessionBootstrap } from './helpers/r10-sql-fixture.mjs';
import { exerciseOwnerInitialRuntime } from './helpers/r12-owner-initial-runtime.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const host = process.env.R12_SQL_TEST_HOST ?? process.env.R11_SQL_TEST_HOST;
for (const legacy of [null, { committedMicrounits: 1000 }]) test(`ordinary owner ${legacy ? 'legacy-root' : 'native-Business'} Continue drives five phases, durable history, repeat Continue and key-free Stop`, { skip: !host, timeout: 120000 }, async () => {
  const require = createRequire(path.resolve(host, 'package.json'));
  const { PGlite } = require('@electric-sql/pglite');
  const { pgcrypto } = require('@electric-sql/pglite/contrib/pgcrypto');
  const db = new PGlite({ extensions: { pgcrypto } });
  try {
    await db.exec(r04SqlBootstrap + sessionBootstrap);
    for (const file of readdirSync(root + '/supabase/migrations').filter(file => file.endsWith('.sql')).sort()) await db.exec(readFileSync(root + '/supabase/migrations/' + file, 'utf8'));
    assert.deepEqual(await exerciseOwnerInitialRuntime(db, { legacy }), { providerCalls: 0, inertPosts: 5, inertReceiptGets: 6, outcome: 'NEEDS_MORE_EVIDENCE', phaseReceipts: 5 });
  } finally { await db.close(); }
});
