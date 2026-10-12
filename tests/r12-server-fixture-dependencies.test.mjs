import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url), ts = require('typescript');
const serverPath = 'src/products/discovery-r12-server.ts';
const profilePath = './discovery-r12-pod-profile';
const profile = require('../.core-tests/products/discovery-r12-pod-profile.js');
const compiled = ts.transpileModule(readFileSync(path.join(root, serverPath), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const imports = [...new Set([...compiled.matchAll(/\brequire\("([^"]+)"\)/g)].map(match => match[1]))];

function visit(node, callback) {
  callback(node);
  ts.forEachChild(node, child => visit(child, callback));
}

// Check the actual strict fixture maps without booting SQL or calling transport.
// SQL-only helpers must fail in ordinary quality CI when a new runtime import is
// omitted, rather than waiting for native controller/race qualification.
test('every strict R12 server fixture binds its runtime imports and the real POD profile', () => {
  const fixtures = ['tests', 'scripts'].flatMap(directory =>
    readdirSync(path.join(root, directory), { recursive: true }).map(file => path.join(directory, file)))
    .filter(file => file.endsWith('.mjs') && path.join(root, file) !== fileURLToPath(import.meta.url))
    .map(file => ({ file, text: readFileSync(path.join(root, file), 'utf8') }))
    .filter(({ text }) => text.includes(serverPath) && text.includes('transpileModule'));
  assert.ok(fixtures.length >= 6, 'Expected all existing strict R12 server fixtures');
  for (const { file, text } of fixtures) {
    const tree = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
    const maps = [];
    visit(tree, node => {
      if (!ts.isObjectLiteralExpression(node)) return;
      const properties = new Map(node.properties.filter(ts.isPropertyAssignment).map(property => [property.name.text, property]));
      if (properties.has('./discovery-r12-server-dependencies')) maps.push(properties);
    });
    assert.equal(maps.length, 1, `${file}: expected one explicit server dependency map`);
    const [dependencies] = maps;
    for (const name of imports) assert.ok(dependencies.has(name), `${file}: missing runtime dependency ${name}`);

    // Resolve the fixture's own initializer, preserving its require path base.
    // Identity proves this is the production profile, not a permissive stub.
    const fixtureRequire = createRequire(path.join(root, file));
    const core = name => require(path.join(root, '.core-tests', name + '.js'));
    const boundProfile = new Function('require', 'req', 'core', 'root', 'repo',
      `return (${dependencies.get(profilePath).initializer.getText(tree)});`)(fixtureRequire, fixtureRequire, core, root, root);
    assert.equal(boundProfile, profile, `${file}: must bind the real compiled profile`);
    assert.equal(boundProfile.isPodThoroughScope({ version: profile.POD_THOROUGH_GOAL_VERSION }), true);
    assert.equal(boundProfile.isPodThoroughScope({ version: 'r12.discovery-owner-initial.1' }), false);
  }
});
