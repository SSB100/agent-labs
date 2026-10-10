import {createHash} from 'node:crypto';
const canonical=v=>Array.isArray(v)?`[${v.map(canonical).join(',')}]`:v&&typeof v==='object'?`{${Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')}}`:JSON.stringify(v);
export const createConfigHash=v=>createHash('sha256').update(canonical(v)).digest('hex');
/** Explicit inert admission leaf for provider/DOM unit tests only. This is not
 * a database attestation or a substitute for the real 21300 RPC in current-chain
 * SQL tests. Historical-boundary fixtures must disclose this injected leaf. */
export function inertSteelCreateConfigurationGuard(options={}){
 const now=options.now??Date.now;
 return{scopeHash:createConfigHash('inert scoped adapter fixture'),deployment:{environment:'production',deploymentId:'dpl_inert_configuration_fixture',releaseCommitSha:'1'.repeat(40)},now,
  async admit(request,signal){signal.throwIfAborted();return inertSteelCreateConfigurationPermit(request,now());},...options};
}
export function inertSteelCreateConfigurationPermit(request,now=Date.now()){
 const{version,...pins}=request;void version;
 const body={version:'r12.steel-create-config-permit.1',...pins,attestationHash:createConfigHash('inert private attestation'),validUntil:new Date(now+25000).toISOString()};
 return{...body,admissionHash:createConfigHash(body)};
}
