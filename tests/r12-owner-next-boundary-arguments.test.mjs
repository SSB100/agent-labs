import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {ownerBoundaryArguments} from './next-fixture/owner-boundary-arguments.mjs';
import * as utils from '../.core-tests/products/discovery-r12-public-utils.js';
import * as deadlines from '../.core-tests/core/request-deadline.js';
const id=n=>`92000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function load(file,deps){const loaded={exports:{}};new Function('require','module','exports',ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(name=>{assert.ok(Object.hasOwn(deps,name),name);return deps[name];},loaded,loaded.exports);return loaded.exports;}
test('Next boundary preserves omitted optional arguments and does not reinterpret explicit null',()=>{
 assert.deepEqual(JSON.parse(JSON.stringify(ownerBoundaryArguments([{},id(1),id(2),undefined]))),[id(1),id(2)]);
 assert.deepEqual(ownerBoundaryArguments([{},id(1),null]),[id(1),null]);
 assert.throws(()=>ownerBoundaryArguments([{},undefined,id(1)]));
});
test('actual enrollment server accepts omitted proposal after JSON boundary and rejects the old null conversion',async()=>{
 const contracts=load('src/products/discovery-r12-direct-enrollment-contracts.ts',{'./discovery-r12-public-utils':utils});
 const server=load('src/products/discovery-r12-direct-enrollment-server.ts',{'server-only':{},'node:crypto':await import('node:crypto'),'../lib/core-ui/owner-business':{verifyOwnerBusiness:async()=>true},'../core/request-deadline':deadlines,'./discovery-r12-public-utils':utils,'./discovery-r12-direct-enrollment-contracts':contracts});
 const calls=[],context={userId:id(3),supabase:{auth:{getClaims:async()=>({data:{claims:{sub:id(3)}},error:null})},rpc:async(name,args)=>{calls.push({name,args});return{data:{version:'r12.owner-direct-enrollment-catalog.1',businessId:id(1),goalId:id(2),ownerId:id(3),eligible:false,reason:'reviewed_package_required',offers:[],current:null},error:null};}}};
 const args=[context,id(1),id(2),undefined],old=JSON.parse(JSON.stringify(args.slice(1))),fixed=JSON.parse(JSON.stringify(ownerBoundaryArguments(args)));
 await assert.rejects(server.readDirectEnrollmentCatalog(context,...old));assert.equal(calls.length,0);
 assert.equal((await server.readDirectEnrollmentCatalog(context,...fixed)).reason,'reviewed_package_required');assert.equal(calls.length,1);assert.equal(calls[0].args.p_proposal_id,null);
});
test('all generated Next facades use the qualified argument boundary and enrollment preserves failure artifacts',()=>{
 for(const file of ['scripts/verify-r12-direct-owner-next.mjs','scripts/verify-r12-direct-enrollment-owner-next.mjs','scripts/verify-r12-steel-current-owner-next.mjs']){const source=readFileSync(file,'utf8');assert.ok(source.includes('args:boundaryArguments(args)'));assert.equal(source.includes('args:args.slice(1)'),false);}
 for(const file of ['scripts/verify-r12-direct-enrollment-owner-next.mjs','scripts/verify-r12-steel-current-owner-next.mjs']){const source=readFileSync(file,'utf8');for(const artifact of ['failure.json','failure.html','failure.png'])assert.ok(source.includes(artifact));assert.ok(source.indexOf("'failure.json'")<source.indexOf('await browser?.close()'));}
});
