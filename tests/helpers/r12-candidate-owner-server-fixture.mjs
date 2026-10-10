/** Actual owner server and strict view/approval reader over migrated public RPCs.
 * Only the Next module loader and request context are inert; owner ACLs are real. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {ownerInitialRpc} from './r12-owner-initial-sql-fixture.mjs';
const require=createRequire(import.meta.url),ts=require('typescript');
const core=name=>require(resolve(process.env.R12_INSIGHTS_CORE_DIR||'.core-tests',name+'.js'));
function load(file,deps){const source=readFileSync(file,'utf8'),loaded={exports:{}};const code=ts.transpileModule(source,{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 new Function('require','module','exports',code)(name=>{assert.ok(Object.hasOwn(deps,name),'Unexpected owner dependency '+name);return deps[name];},loaded,loaded.exports);return loaded.exports;}
export function candidateOwnerServer(db,scope){
 const calls=[],contracts=core('accounts/etsy-steel-handoff-contracts'),owner=load('src/accounts/etsy-steel-handoff-owner.ts',{'./etsy-steel-handoff-contracts':contracts});
 const server=load('src/accounts/etsy-steel-handoff-owner-server.ts',{'server-only':{},'../lib/core-ui/owner-business':load('src/lib/core-ui/owner-business.ts',{}),'../core/request-deadline':require('../../.core-tests/core/request-deadline.js'),'./etsy-steel-handoff-contracts':contracts,'./etsy-steel-handoff-owner':owner});
 const context={userId:scope.ownerId,businesses:[{id:scope.businessId,name:'Inert candidate owner'}],supabase:{auth:{getClaims:async()=>({data:{claims:{sub:scope.ownerId}},error:null})},rpc:async(name,args)=>{
  calls.push({name,args:structuredClone(args)});try{
   assert.ok(['r12_etsy_steel_owner','r12_owner_etsy_steel_renderer_review','r12_owner_etsy_steel_verification_read'].includes(name));
   const values=name==='r12_etsy_steel_owner'?[args.p_business_id,args.p_operation,args.p_payload]:[args.p_business_id,args.p_operation_id];
   return{data:await ownerInitialRpc(db,scope.ownerId,name,values),error:null};
  }catch(error){return{data:null,error};}
 }}};
 return{calls,context,server,read:()=>server.readEtsySteelOwnerRendererReview(context,scope.businessId,scope.operationId),approve:input=>server.approveEtsySteelOwnerSetup(context,scope.businessId,scope.operationId,input),stop:()=>server.stopEtsySteelOwnerSetup(context,scope.businessId,scope.operationId)};
}
