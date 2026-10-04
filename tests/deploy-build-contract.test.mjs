import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const json=p=>JSON.parse(readFileSync(new URL(p,import.meta.url),'utf8'));
test('deployment packaging does not repeat or weaken the complete CI gate',()=>{
 const pkg=json('../package.json'),vercel=json('../vercel.json');
 assert.equal(pkg.scripts.build,'npm run quality && next build');assert.equal(pkg.scripts.check,'npm run build');
 assert.equal(pkg.scripts.quality,'npm run lint && npm run typecheck && npm test');
 assert.equal(pkg.scripts['deploy:build'],'next build');assert.equal(vercel.buildCommand,"node -e \"if (process.env.VERCEL_ENV !== 'preview' || process.env.VERCEL_TARGET_ENV !== 'preview') { console.error('R10 diagnostic builds require Preview'); process.exit(1); }\" && npm run deploy:build");
 assert.equal(vercel.git.deploymentEnabled['feat/r07-quest-controller'],false);
 const ci=readFileSync(new URL('../.github/workflows/ci.yml',import.meta.url),'utf8');
 for(const job of ['quality','r03-next','r04-sql','r05-sql','r06-sql','r07-sql'])assert.match(ci,new RegExp(`^  ${job}:`,'m'));
 assert.match(ci,/npm run lint && npm run typecheck && node --test tests\/\*\.test\.mjs && npx next build/);
});

// This temporary diagnostic branch must fail before packaging in every non-Preview target.
test('R10 diagnostic build guard accepts only exact Preview system targets',()=>{
 const command=json('../vercel.json').buildCommand;
 const match=command.match(/^node -e "([^"]+)" && npm run deploy:build$/);
 assert.ok(match);
 for(const primary of [undefined,'','production','development','preview','Preview','preview ']){
  for(const target of [undefined,'','production','development','staging','preview','preview ']){
   const env={...process.env};delete env.VERCEL_ENV;delete env.VERCEL_TARGET_ENV;
   if(primary!==undefined)env.VERCEL_ENV=primary;if(target!==undefined)env.VERCEL_TARGET_ENV=target;
   const result=spawnSync(process.execPath,['-e',match[1]],{env,encoding:'utf8',timeout:5000});
   const allowed=primary==='preview'&&target==='preview';
   assert.equal(result.status,allowed?0:1,JSON.stringify({primary,target}));
   assert.equal(result.stdout,'');assert.equal(result.stderr,allowed?'':'R10 diagnostic builds require Preview\n');
  }
 }
 const deployments=json('../vercel.json').git.deploymentEnabled;
 for(const branch of ['ui/r03-retained-console','feat/r04-business-quest','feat/r05-operating-envelope','feat/r06-bounded-reads','feat/r07-quest-controller','feat/r08-owner-workspace','feat/r09-reviewed-knowledge','feat/r10-private-browser-viewer'])assert.equal(deployments[branch],false);
 assert.equal(Object.keys(deployments).length,9);
 assert.equal(typeof deployments['test/r10-host-lifetime-probe'],'boolean');
});
