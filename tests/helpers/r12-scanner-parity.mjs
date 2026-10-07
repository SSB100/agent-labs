/** Scanner security parity on the fully migrated disposable SQL fixture. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const released=readFileSync(new URL('../../supabase/migrations/20261007005630_r12_focused_pilot.sql',import.meta.url),'utf8').match(/create function private\.r12_pilot_safe\([\s\S]*?end \$\$;/)[0];
const migration=readFileSync(new URL('../../supabase/migrations/20261007114310_r12_pilot_scanner_subtrees.sql',import.meta.url),'utf8').replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,'');

export function scannerParityCases(){
 const cases=[{label:'SQL null',value:null},{label:'JSON null',value:'null'}];
 const add=(label,value)=>cases.push({label,value:JSON.stringify(value)});
 for(const value of [{},[],true,false,0,'ordinary public context'])add('primitive',value);
 for(const target of [19996,19997,19998,19999,20000,20001])for(const seed of ['x','\\','"','\n','\t','é','😀']){
  let key=seed.repeat(500);const size=()=>Buffer.byteLength(JSON.stringify({[key]:0}))+1;
  key+='x'.repeat(target-size());assert.equal(size(),target);
  for(const value of [0,null,'',true])add(`key ${JSON.stringify(seed)} numeric-container ${target}`,{[key]:value});
  add(`nested boundary ${target}`,{outer:[{[key]:0}]});
 }
 for(const size of [19997,19998,19999,20000,20001,65535,65536,65537])add(`scalar ${size}`,'x'.repeat(size-2));
 for(const target of [65535,65536,65537]){const items=Array.from({length:4},()=> 'x'.repeat(16000));const size=Buffer.byteLength(JSON.stringify({items}))+4;items[0]+='x'.repeat(target-size);add(`aggregate ${target}`,{items});}
 const credentials=['-----BEGIN PRIVATE KEY-----','password: inert-example','passwd = inert-example','secret is inert-example','client-secret: inert-example','api_key: inert-example','access token: inert-example','refresh-token: inert-example',
  'Bearer syntheticcredential1234','Basic aW5lcnQtZml4dHVyZQ==','sk-'+ 'a'.repeat(20),'rk_live_'+ 'a'.repeat(12),'sk_test_'+ 'a'.repeat(12),
  ...['b','a','p','r','s'].map(x=>'xox'+x+'-'+'a'.repeat(12)),...['p','o','u','s','r'].map(x=>'gh'+x+'_'+'a'.repeat(20)),
  'AKIA'+'A'.repeat(16),'ASIA'+'A'.repeat(16),'github_pat_'+'a'.repeat(24),'https://inert:example@fixture.invalid','eyJ'+'a'.repeat(10)+'.'+'b'.repeat(10)+'.'+'c'.repeat(10)];
 for(const credential of credentials){add('credential family',credential);let nested=credential;for(let i=0;i<12;i++)nested={a:[nested]};add('deep credential family',nested);for(const target of [19997,19998]){const value={a:credential,padding:''};value.padding='x'.repeat(target-Buffer.byteLength(JSON.stringify(value))-3);add('credential delegation edge',value);}}
 for(const key of ['password','passwd','secret','secret_key','client-secret','token','apiKey','access token','refresh_token'])add('credential key',{nested:[{[key]:'inert'}]});
 for(const depth of [16,64,128,256]){let value='ordinary';for(let i=0;i<depth;i++)value={child:[value]};cases.push({label:`resource depth ${depth}`,value:JSON.stringify(value),resourceProbe:true});}
 return cases;
}

export async function assertR12ScannerParity(db,{engine}){
 // Adversarial recursion/error-stack probes qualify the real PostgreSQL
 // backend. PGlite is the Next snapshot transport; its WASM error stack can
 // abort before JavaScript can catch deep scanner errors. Runtime lifecycle
 // assertions still run there; the native SQL gate retains the full corpus.
 if(engine==='pglite')return{skipped:true,reason:'native_postgresql_qualification'};
 assert.equal(engine,'postgresql','Explicit SQL fixture engine required');
 const one=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
 const catalog=()=>db.query("select oid,proowner,proacl,provolatile,proparallel,prosecdef,proisstrict,proleakproof,proconfig,pg_get_functiondef(oid) definition from pg_proc where oid in ('private.r04_safe(jsonb)'::regprocedure,'private.r12_pilot_safe(jsonb)'::regprocedure) order by oid");
 const before=(await catalog()).rows,resources=[];let rejected=0;
 await db.exec('begin');
 try{
  await db.exec(released.replaceAll('private.r12_pilot_safe(','private.r12_pilot_safe_reference('));
  await db.exec('revoke all on function private.r12_pilot_safe_reference(jsonb) from public,anon,authenticated,service_role');
  const outcome=async(name,value)=>{await db.exec('savepoint scanner_case');try{await db.query(`select private.${name}($1::jsonb)`,[value]);return{code:'accepted',message:''};}catch(error){return{code:error.code,message:error.message};}finally{await db.exec('rollback to savepoint scanner_case');await db.exec('release savepoint scanner_case');}};
  for(const testCase of scannerParityCases()){
   const old=await outcome('r12_pilot_safe_reference',testCase.value),current=await outcome('r12_pilot_safe',testCase.value);
   if(testCase.resourceProbe){for(const result of [old,current])assert.ok(['accepted','54001','54000'].includes(result.code));resources.push({label:testCase.label,old:old.code,current:current.code});}
   else assert.deepEqual(current,old,testCase.label);
   if(old.code!=='accepted')rejected++;
  }
  const r04=(await one("select pg_get_functiondef('private.r04_safe(jsonb)'::regprocedure) definition")).definition;
  // Verify both exact body drift guards and an unexpected grant fail closed.
  for(const which of ['r04','pilot','grant']){
   await db.exec('savepoint scanner_definition_drift');
   try{
    await db.exec(released.replace('create function','create or replace function'));
    if(which==='r04')await db.exec(r04.replace('AS $function$',()=> 'AS $function$\n-- deliberate test-only definition drift'));
    if(which==='pilot')await db.exec(released.replace('create function','create or replace function').replace('as $$',()=> 'as $$\n-- deliberate test-only definition drift'));
    if(which==='grant')await db.exec('grant execute on function private.r12_pilot_safe(jsonb) to anon');
    await assert.rejects(()=>db.exec(migration),/r12_pilot_scanner_definition_drift/);
   }finally{await db.exec('rollback to savepoint scanner_definition_drift');await db.exec('release savepoint scanner_definition_drift');}
  }
  await db.exec('savepoint scanner_catalog_parity');
  try{await db.exec(released.replace('create function','create or replace function'));await db.exec(migration);assert.deepEqual((await catalog()).rows,before,'Only intended scanner body changes; r04 and all scanner catalog properties remain exact');}
  finally{await db.exec('rollback to savepoint scanner_catalog_parity');await db.exec('release savepoint scanner_catalog_parity');}
 }finally{await db.exec('rollback');}
 assert.deepEqual((await catalog()).rows,before,'Parity qualification leaves all definitions and permissions unchanged');
 const result={cases:scannerParityCases().length,rejected,resourceProbes:resources};console.log('R12 fully migrated scanner parity:',JSON.stringify(result));return result;
}
