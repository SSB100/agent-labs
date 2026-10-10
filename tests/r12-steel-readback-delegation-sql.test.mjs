/** One authentic focused-creative activation, observed before launch. The
 * enclosing original lifecycle rolls the entire fixture transaction back. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readbackTarget,publishReadback,one,sha} from './helpers/r12-steel-readback-sql-fixture.mjs';
import {exerciseFocusedPilotLifecycle} from './helpers/r12-focused-pilot-sql-fixture.mjs';
import {exerciseFocusedCreativeLifecycle} from './helpers/r12-focused-creative-sql-fixture.mjs';
import {originalReadbackR11,readbackAuthorization,publishReadbackAuthorization} from './helpers/r12-steel-readback-authorization-fixture.mjs';
test('genuine active focused-creative child remains forbidden as metadata root even with reviewed R11 provenance',{
 skip:!process.env.R12_SQL_TEST_HOST,timeout:300000,
},async()=>{
 const savedMode=process.env.R12_RPC_HTTP_ONLY,savedFetch=globalThis.fetch;process.env.R12_RPC_HTTP_ONLY='1';let fixture,observed=0;
 globalThis.fetch=async()=>{throw Error('External provider transport forbidden');};
 try{
  const {prepareR12OwnerWorkflows}=await import('./r12-discovery-scope-sql.test.mjs');fixture=await prepareR12OwnerWorkflows();
  await fixture.exerciseOwnerEpisode(async({db,evidence})=>{
   const pilot=await exerciseFocusedPilotLifecycle(db,evidence,{nested:true});
   await exerciseFocusedCreativeLifecycle(db,pilot,{onActivated:async f=>{
    observed++;
    const root=await one(db,'select to_jsonb(k) content from private.r05_server_keys k where key_hash=$1',[sha(f.key)]);assert.ok(Date.parse(root.content.expires_at)>Date.now());
    assert.equal((await one(db,'select count(*)::int n from private.r05_server_revocations where key_hash=$1',[sha(f.key)])).n,0);
    const proof=await originalReadbackR11(db,{key:f.key,context:f});proof.target=readbackTarget(proof);await publishReadback(db,proof.target);
    const authorization=await readbackAuthorization(db,proof);
    const reject=async(work,pattern)=>{await db.exec('savepoint metadata_child_denial');try{await assert.rejects(work,pattern);}finally{await db.exec('rollback to savepoint metadata_child_denial');await db.exec('release savepoint metadata_child_denial');}};
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[f.ownerId]);
    await reject(()=>db.query("select public.r12_steel_config_readback_server($1,'claim',$2,$3)",[f.businessId,{targetHash:proof.target.targetHash,submissionId:randomUUID()},f.key]),{code:'42501',message:/root_required/});
    await reject(()=>publishReadbackAuthorization(db,authorization),/expired_root_required/);
    assert.equal((await one(db,'select count(*)::int n from private.r12_steel_readback_authorizations where target_hash=$1',[proof.target.targetHash])).n,0);
    assert.equal((await one(db,'select count(*)::int n from private.r12_steel_readback_claims where target_hash=$1',[proof.target.targetHash])).n,0);
    assert.deepEqual(await one(db,'select to_jsonb(k) content from private.r05_server_keys k where key_hash=$1',[sha(f.key)]),root);
    return{qualified:true,creativePosts:0,metadataGets:0};
   }});
  });
  assert.equal(observed,1);
 }finally{await fixture?.close();globalThis.fetch=savedFetch;if(savedMode===undefined)delete process.env.R12_RPC_HTTP_ONLY;else process.env.R12_RPC_HTTP_ONLY=savedMode;}
});
