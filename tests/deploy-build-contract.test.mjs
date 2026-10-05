import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const json=p=>JSON.parse(readFileSync(new URL(p,import.meta.url),'utf8'));
test('deployment packaging does not repeat or weaken the complete CI gate',()=>{
 const pkg=json('../package.json'),vercel=json('../vercel.json');
 assert.equal(pkg.scripts.build,'npm run quality && next build');assert.equal(pkg.scripts.check,'npm run build');
 assert.equal(pkg.scripts.quality,'npm run lint && npm run typecheck && npm test');
 assert.equal(pkg.scripts['deploy:build'],'next build');assert.equal(vercel.buildCommand,'npm run deploy:build');
 assert.equal(vercel.git.deploymentEnabled['feat/r07-quest-controller'],false);
 const ci=readFileSync(new URL('../.github/workflows/ci.yml',import.meta.url),'utf8');
 for(const job of ['quality','r03-next','r04-sql','r05-sql','r06-sql','r07-sql'])assert.match(ci,new RegExp(`^  ${job}:`,'m'));
 assert.match(ci,/npm run lint && npm run typecheck && node --test tests\/\*\.test\.mjs && npx next build/);
});
