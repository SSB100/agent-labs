import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const migrationName=readdirSync(path.join(root,'supabase/migrations')).find(name=>name.endsWith('_stage15_product_configuration.sql'));
const migration=readFileSync(path.join(root,'supabase/migrations',migrationName),'utf8');
const regression=readFileSync(path.join(root,'supabase/tests/stage15_product_configuration.sql'),'utf8');
test('product SQL is additive and installs no sources, enabled authority, provider calls or historical rewrites',()=>{
 assert.doesNotMatch(migration,/create or replace function|alter table (?:public|private)\.(?:provider_connections|connected_accounts|creative_|etsy_)/i);
 assert.doesNotMatch(migration,/insert into private\.printful_product_(?:sources|server_authority|write_authorities)\s*\(/i);
 assert.doesNotMatch(migration,/http_post|net\.http|product\.package\.v1/);
 assert.match(migration,/enabled boolean not null default false/);
 assert.match(migration,/scopes='\["product\.configure"\]'/);
 assert.match(migration,/sync_products\/read/); assert.match(migration,/file_library\/read/);
});
test('product SQL keeps owner+separate server-key authority and no private data grants',()=>{
 assert.match(migration,/if not private\.is_business_owner\(p_business_id\)/);
 assert.match(migration,/private\.printful_product_server_authority where key_hash=private\.stage13_hash\(p_server_key\) and enabled/);
 assert.match(migration,/revoke all on private\.%I from public,anon,authenticated,service_role/);
 assert.doesNotMatch(migration,/grant (?:select|insert|update|delete|all) on/i);
 assert.match(migration,/stage15_product_core_identity[\s\S]*?security definer set search_path=''/);
 assert.match(migration,/select private\.is_business_owner\(p_business\) and exists/);
 assert.match(migration,/stage15_product_core_guard\(\) returns trigger language plpgsql set search_path=''/);
});
test('product SQL reloads current TEST/production approval and latest exact reviewed asset before dispatch',()=>{
 assert.match(migration,/purpose='candidate_production'/); assert.match(migration,/private\.stage14_assert_approval\(a\.candidate_id,a\.snapshot\)/);
 assert.match(migration,/newer\.version>asset\.version/); assert.match(migration,/product_asset_provenance_not_current/);
 assert.match(migration,/product_goal_or_workflow_stopped/); assert.match(migration,/product_stock_evidence_required/); assert.match(migration,/product_cost_evidence_required/);
 assert.match(migration,/product_placement_producer_required/); assert.match(migration,/product_source_expired/);
});
test('product SQL has durable single source identity, CAS, immutable marker and acquisition epoch',()=>{
 assert.match(migration,/source_id uuid not null unique/); assert.match(migration,/stale_product_revision/);
 assert.match(migration,/dispatch_lease_generation uuid not null/); assert.match(migration,/lease_generation=gen_random_uuid\(\)/);
 assert.match(migration,/dispatch_lease_generation=r\.lease_generation/);
 assert.match(migration,/product_dispatch_cannot_be_reset/); assert.match(migration,/product_observed_identity_immutable/);
 assert.match(migration,/product_dispatch_required/); assert.match(migration,/product_observation_immutable/);
});
test('product SQL finish cannot manufacture complete configuration or a listing package',()=>{
 assert.match(migration,/actual_receipt->>'outcome' is distinct from 'uncertain'/);
 assert.match(migration,/actual_resource->>'status' is distinct from 'pending'/);
 assert.match(migration,/'physicalPlacementVerified',false,'techniqueVerified',false,'configurationVerified',false/);
 assert.match(migration,/'listingReady',false,'publicationAuthorized',false,'orderSubmissionAuthorized',false/);
 assert.match(migration,/'providerFactsHash',private\.stage14_hash\(jsonb_build_object/);
 assert.doesNotMatch(migration,/set status='completed'/);
 assert.match(migration,/Normalize a concurrent owner Stop/);
});
test('rollback SQL covers permission, stale TEST, exact assets, expiry, source ingress, uncertainty and ordinary invoker writes',()=>{
 for(const marker of ['current exact persisted TEST','product_production_approval_required','product_stock_evidence_required','product_cost_evidence_required','product_asset_provenance_not_current','product_source_expired','register_source','product_observation_binding_invalid','product_dispatch_cannot_be_reset','product_observed_identity_immutable','product_already_dispatched','isolated_product_guard']) assert.ok(regression.includes(marker),marker);
 assert.match(regression,/^begin;/m); assert.match(regression,/rollback;\s*$/);
});

// Explicit opt-in offline integration. No hosted DB URL, network, provider call,
// package install or migration application is used. Point to a preinstalled local
// PGlite package host directory (package.json + node_modules), then compile the
// project's normal core-test output first. CI's default unit run skips this one.
test('isolated SQL replay + real TS adapter/engine/SQL finish wire', {skip: !process.env.PRINTFUL_SQL_TEST_HOST}, async()=>{
 const localRequire=createRequire(path.resolve(process.env.PRINTFUL_SQL_TEST_HOST,'package.json'));
 const {PGlite}=localRequire('@electric-sql/pglite'),{pgcrypto}=localRequire('@electric-sql/pglite/contrib/pgcrypto');
 const require=createRequire(path.join(root,'package.json'));
 const P=require('./.core-tests/printful/production.js'),E=require('./.core-tests/printful/product-engine.js'),A=require('./.core-tests/printful/product-adapter.js');
 const db=new PGlite({extensions:{pgcrypto}}); const calls=[];
 try {
await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; create schema extensions; create extension pgcrypto with schema extensions;
create function auth.uid() returns uuid language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',aud text,role text,encrypted_password text,email_confirmed_at timestamptz,raw_app_meta_data jsonb,created_at timestamptz,updated_at timestamptz);
grant usage on schema auth to authenticated,anon,service_role; grant execute on function auth.uid() to authenticated,anon,service_role;
create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb default '{}',owner uuid,unique(bucket_id,name));
alter table storage.objects enable row level security;
grant usage on schema storage to anon,authenticated; grant select,insert,update,delete on storage.objects to anon,authenticated;
create publication supabase_realtime;
`);

 const files=readdirSync(path.join(root,'supabase/migrations')).filter(n=>n.endsWith('.sql')).sort();
 for(const name of files.filter(n=>n!==migrationName)) await db.exec(readFileSync(path.join(root,'supabase/migrations',name),'utf8'));
 const procedureSnapshot=async()=> (await db.query(`select oid,prosrc,proacl::text,prosecdef,proconfig from pg_proc where pronamespace in ('public'::regnamespace,'private'::regnamespace) order by oid`)).rows;
 const tableSnapshot=async()=> (await db.query(`select oid,relacl::text,relrowsecurity from pg_class where relnamespace in ('public'::regnamespace,'private'::regnamespace) and relkind='r' order by oid`)).rows;
 const beforeProcedures=await procedureSnapshot(),beforeTables=await tableSnapshot();
 const beforeRows=[];
 for(const {schema,name} of (await db.query(`select n.nspname as schema,c.relname as name from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private') and c.relkind='r' order by n.nspname,c.relname`)).rows){
  const quoted=`"${schema.replaceAll('"','""')}"."${name.replaceAll('"','""')}"`;
  beforeRows.push({quoted,...(await db.query(`select count(*)::integer n,md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]')::text) h from ${quoted} t`)).rows[0]});
 }
 await db.exec(migration);
 const ids=new Set(beforeProcedures.map(p=>p.oid));assert.deepEqual((await procedureSnapshot()).filter(p=>ids.has(p.oid)),beforeProcedures);
 const tableIds=new Set(beforeTables.map(t=>t.oid));assert.deepEqual((await tableSnapshot()).filter(t=>tableIds.has(t.oid)),beforeTables);
 for(const row of beforeRows) assert.deepEqual((await db.query(`select count(*)::integer n,md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]')::text) h from ${row.quoted} t`)).rows[0],{n:row.n,h:row.h});
 await db.exec((await fs.readFile(root+'/supabase/tests/stage15_product_configuration.sql','utf8')).replace(/\nrollback;\s*$/,'\n'));
 await db.exec(`select set_config('request.jwt.claim.sub','15000000-1111-4111-8111-000000000090',true);update private.connected_accounts set status='connected' where provider='printful';`);
 const [{sid}]=(await db.query(`select pg_temp.seed_product_source(9) sid`)).rows;
 const [{source}]=(await db.query(`select source from private.printful_product_sources where id=$1`,[sid])).rows;
 P.validateProductSource(source);
 const [{payload}]=(await db.query(`select pg_temp.product_payload($1::uuid) payload`,[sid])).rows;
 const b=source.businessId,key='product-fixture-server-'.repeat(3),lease='wire-lease-'.repeat(6);
 const rpc=async(op,p={})=>(await db.query(`select public.printful_product_owner_transition($1::uuid,$2,$3::jsonb,$4) result`,[b,op,JSON.stringify(p),key])).rows[0].result;
 const {runId}=await rpc('prepare',payload);let rev=0;
 let first=await rpc('acquire',{runId,lease});
 first.state.status='running';first.state.dispatch={requestHash:first.state.requestHash,sentAt:new Date().toISOString()};
 await rpc('save',{runId,lease,revision:first.revision,state:first.state});await rpc('release',{runId,lease});
 const repository={
  async acquire(){const r=await rpc('acquire',{runId,lease:'next-'+lease});rev=r.revision;return r.state;},
  async guard(mode){return rpc('guard',{runId,lease:'next-'+lease,mode});},
  async save(state){const r=await rpc('save',{runId,lease:'next-'+lease,revision:rev,state});rev=r.revision;Object.assign(state,r.state);},
  async finish(state,receipt,resource){const r=await rpc('finish',{runId,lease:'next-'+lease,revision:rev,state,receipt,resource});rev=r.revision;Object.assign(state,r.state);},
  async release(){await rpc('release',{runId,lease:'next-'+lease});},
  async assetBytes(){throw Error('No upload or bytes read allowed during reconciliation');}
 };
 const scope={businessId:b,connectionId:source.connectionId,connectionRevision:source.connectionRevision,storeId:source.storeId,storeKind:'manual_api'};
 const file={id:source.printfulFileId,type:'default',hash:source.fileBinding.providerMd5,mime_type:'image/png',width:1200,height:1200,dpi:200,status:'ok',is_temporary:false};
 const product={code:200,result:{sync_product:{id:9501,external_id:P.productIdentity(source),name:source.name,variants:1,synced:1,is_ignored:false},sync_variants:[{id:9502,external_id:P.productIdentity(source)+'-v',sync_product_id:9501,synced:true,variant_id:source.plan.variantId,retail_price:source.retailPrice,currency:source.currency,is_ignored:false,product:{product_id:source.plan.productId,variant_id:source.plan.variantId},files:[file],availability_status:'active'}]}};
 const provider=new A.PrintfulProductAdapter({scope,mode:'provider_response',authorize:async()=>({...scope,provider:'printful',status:'connected',permittedOperations:['product.configure'],providerScopes:['sync_products/read','sync_products/write','file_library/read','stores_list/read'],expiresAt:source.expiresAt,credential:'offline-placeholder-no-real-token'}),fetcher:async(url,opts)=>{
  calls.push(opts.method+' '+new URL(url).pathname);assert.equal(opts.method,'GET');
  const body=new URL(url).pathname.startsWith('/stores/')?{code:200,result:{id:source.storeId,type:'native'}}:new URL(url).pathname.startsWith('/files/')?{code:200,result:file}:product;
  return new Response(JSON.stringify(body),{headers:{'content-type':'application/json'}});
 }});
 const result=await E.executePrintfulProduct(repository,provider);
 assert.equal(result.status,'needs_owner');assert.equal(result.receiptRecorded,true);assert.ok(result.observationHash);
 const [stored]=(await db.query(`select ar.outcome,ar.response_summary,er.status from public.action_receipts ar join public.external_resources er on er.id=ar.external_resource_id where ar.id=$1`,[result.receiptId])).rows;
 assert.equal(stored.outcome,'uncertain');assert.equal(stored.status,'pending');assert.equal(stored.response_summary.configurationVerified,false);
 assert.notEqual(stored.response_summary.providerFactsHash,source.providerFactsHash);assert.equal(P.productHash(stored.response_summary),result.observationHash);
 const before=calls.length;await E.executePrintfulProduct(repository,provider);assert.equal(calls.length,before);
 assert.ok(calls.length>=5); assert.ok(calls.every(call=>call.startsWith('GET '))); 
 await db.exec('rollback');

 } finally { await db.close(); }
});
