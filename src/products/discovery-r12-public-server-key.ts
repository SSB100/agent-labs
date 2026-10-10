import {createHmac} from 'node:crypto';
export type DirectServerKeyPurpose='handoff'|'verification'|'cleanup'|'evidence'|'controller'|'admission'|'source';
export type DirectServerKeyPins={businessId:string;goalId:string;testEnvelopeId:string;envelopeHash:string;routeHash:string;purpose:DirectServerKeyPurpose};
/** Server-only secret composition. Callers must never return the result in a
 * catalog, response, browser artifact, model input, or log. SQL independently
 * derives the identical key from the authenticated existing grant bootstrap. */
export function deriveDirectServerKey(grantBootstrapKey:string,pins:DirectServerKeyPins):string{
 const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i,hash=/^[a-f0-9]{64}$/;
 if(typeof grantBootstrapKey!=='string'||grantBootstrapKey.length<32||grantBootstrapKey.length>200||![pins.businessId,pins.goalId,pins.testEnvelopeId].every(v=>uuid.test(v))||![pins.envelopeHash,pins.routeHash].every(v=>hash.test(v))||!['handoff','verification','cleanup','evidence','controller','admission','source'].includes(pins.purpose)||Object.keys(pins).sort().join(',')!=='businessId,envelopeHash,goalId,purpose,routeHash,testEnvelopeId')throw new Error('r12_direct_key_scope_invalid');
 const p={version:'r12.direct-server-key.1',...pins};
 const canonical=`{${Object.keys(p).sort().map(k=>`${JSON.stringify(k)}:${JSON.stringify(p[k as keyof typeof p])}`).join(',')}}`;
 return createHmac('sha256',grantBootstrapKey).update(canonical).digest('base64url');
}
