import type { QualificationWorkspace, OwnShopReadWindow } from './contracts';

export type EtsyConnectionReadiness = {
  status:'unavailable'|'not_connected'|'needs_attention'|'connected';
  title:string; detail:string; checkedAt:string|null; draftCount:number|null;
  canCheck:boolean; needsRefresh:boolean; reconnect:boolean;
};
const instant=(value:unknown):number=>typeof value==='string'?Date.parse(value):NaN;
const activeStates=['reserved','refresh_marked','rotated','read_marked','expired_unverified'];
export function etsyReadWindowReadiness(view:QualificationWorkspace,w:OwnShopReadWindow,now=Date.now()):{canCheck:boolean;needsRefresh:boolean;detail:string}{
  const blocked=(detail:string,needsRefresh=false)=>({canCheck:false,needsRefresh,detail});
  const matches=view.connections.filter(c=>c.provider==='etsy'&&c.id===w.connectionId&&c.revision===w.bindingRevision),c=matches[0];
  if(view.unavailable||!view.configured||!w.configured||matches.length!==1||!c||!['connected','token_expired'].includes(c.status)||c.custody!=='encrypted_oauth'||
    !Number.isFinite(instant(c.expiresAt))||instant(c.expiresAt)<=now||!Number.isFinite(instant(c.verifiedAt))||instant(c.verifiedAt)>now||
    c.providerScopes?.length!==2||!['shops_r','listings_r'].every(scope=>c.providerScopes!.includes(scope))||
    c.permittedOperations.length!==2||!['shop.read','listing.read'].every(op=>c.permittedOperations.includes(op)))return blocked('Check the saved connection and exact read scopes before using this window.');
  if(w.state==='revoked')return blocked('Stopped. This window cannot send more requests. Saved receipts remain available.');
  if(!Number.isFinite(instant(w.expiresAt))||instant(w.expiresAt)<=now)return blocked('This operating window has expired. Review a new bounded read approval; reconnect Etsy only if its connection also needs renewal.');
  if(w.currentSessionMatches!==true)return blocked(w.currentSessionMatches===false?'This window belongs to an earlier Agent Labs sign-in. Approve a new bounded window for this sign-in; an Etsy reconnect is not needed for that alone.':'Current sign-in eligibility is unavailable. Reload the saved status before checking.');
  if(w.state==='expired')return blocked('The Agent Labs sign-in for this window has expired. Sign in again and review a new bounded operation.');
  if(w.state!=='available'||!Number.isSafeInteger(w.readsDispatched)||w.readsDispatched<0||!Number.isSafeInteger(w.maxReads)||w.readsDispatched>=w.maxReads)return blocked('No reads remain in this window. Review a new bounded read approval.');
  const active=(view.readAttempts??[]).find(a=>a.connectionId===c.id&&a.bindingRevision===c.revision&&activeStates.includes(a.status));
  if(active)return blocked(active.canReconcile?'Reconcile the interrupted saved attempt below before choosing another check.':'A saved check is still in progress. Reload its outcome; another request will not replay it.');
  const tokenTime=instant(c.tokenExpiresAt),needsRefresh=w.mode==='qualification'||c.status==='token_expired'||!Number.isFinite(tokenTime)||tokenTime<=now+60_000;
  if(needsRefresh){
    if(!Number.isSafeInteger(w.refreshesDispatched)||w.refreshesDispatched<0||!Number.isSafeInteger(w.maxRefreshes)||w.refreshesDispatched>=w.maxRefreshes)return blocked('The token needs refresh, but no refreshes remain. Review a new bounded read approval.',true);
    if(w.refreshNotBefore&&(!Number.isFinite(instant(w.refreshNotBefore))||instant(w.refreshNotBefore)>now))return blocked(`The approved refresh interval has not elapsed. Check again after ${w.refreshNotBefore}.`,true);
  }
  return {canCheck:true,needsRefresh,detail:needsRefresh?'This check may refresh the existing token within this window’s unchanged scope and cutoff.':'Ready for one read of this shop’s draft count.'};
}
/** Saved metadata only. Opening this page never calls Etsy or renews access. */
export function etsyConnectionReadiness(view:QualificationWorkspace,now=Date.now()):EtsyConnectionReadiness{
  const result=(status:EtsyConnectionReadiness['status'],title:string,detail:string,extra:Partial<EtsyConnectionReadiness>={}):EtsyConnectionReadiness=>({status,title,detail,checkedAt:null,draftCount:null,canCheck:false,needsRefresh:false,reconnect:false,...extra});
  if(!Number.isSafeInteger(now)||view.unavailable)return result('unavailable','Connection status unavailable','Reload to read the saved connection. No new access is assumed.');
  const connections=view.connections.filter(c=>c.provider==='etsy');
  if(connections.length>1)return result('unavailable','Connection status unavailable','Conflicting account bindings need verification.');
  const c=connections[0];
  if(!c)return result('not_connected','Connect your Etsy shop','Review read-only OAuth consent for the existing Etsy application.',{reconnect:true});
  if(c.status==='revoked')return result('needs_attention','Etsy access is disconnected','Reconnect requires fresh approval and Etsy consent. Previous windows stay stopped.',{reconnect:true});
  if(c.status==='expired'||instant(c.expiresAt)<=now)return result('needs_attention','Etsy access has expired','The local access cutoff has passed. Review a clean read-only reconnect; the old cutoff is not extended.',{reconnect:true});
  if(['refresh_uncertain','refresh_unverified'].includes(c.status))return result('needs_attention','Etsy access needs a clean reconnect','A previous token refresh is uncertain or was not verified. It will not be replayed or repaired automatically. Review fresh read-only consent.',{reconnect:true});
  if(!view.configured||c.status==='credential_changed')return result('needs_attention','Etsy configuration needs review','The approved application configuration is missing or changed. Verify it before requesting consent.');
  if(!['connected','token_expired'].includes(c.status)||!Number.isFinite(instant(c.expiresAt))||
    !Number.isFinite(instant(c.verifiedAt))||instant(c.verifiedAt)>now||c.custody!=='encrypted_oauth'||
    c.providerScopes?.length!==2||!['shops_r','listings_r'].every(scope=>c.providerScopes!.includes(scope))||
    c.permittedOperations.length!==2||!['shop.read','listing.read'].every(op=>c.permittedOperations.includes(op)))
    return result('needs_attention','Etsy connection needs verification','The saved account, scope or encrypted custody is not suitable for this read path. Review the exact connection before reuse.');
  const windows=(view.readWindows??[]).filter(w=>w.connectionId===c.id&&w.bindingRevision===c.revision&&w.mode==='lazy').map(w=>etsyReadWindowReadiness(view,w,now)),window=windows.find(w=>w.canCheck);
  const tokenTime=instant(c.tokenExpiresAt),needsRefresh=c.status==='token_expired'||!Number.isFinite(tokenTime)||tokenTime<=now+60_000;
  const latest=(view.readAttempts??[]).filter(a=>a.connectionId===c.id&&a.bindingRevision===c.revision&&a.status==='succeeded'&&a.proof&&
    Number.isFinite(instant(a.proof.verifiedAt))&&instant(a.proof.verifiedAt)<=now&&Number.isSafeInteger(a.proof.totalDrafts)&&a.proof.totalDrafts>=0&&
    Number.isSafeInteger(a.proof.listingCount)&&[0,1].includes(a.proof.listingCount)&&a.proof.totalDrafts>=a.proof.listingCount)
    .sort((a,b)=>instant(b.proof!.verifiedAt)-instant(a.proof!.verifiedAt))[0];
  const proof=latest?.proof;
  return result(needsRefresh?'needs_attention':'connected',needsRefresh?'A connection check is needed':'Connected for read-only shop access',
    window?window.detail:windows[0]?.detail??'The saved connection has no current approved read window. Review a bounded operation before using it.',
    {checkedAt:proof?.verifiedAt??null,draftCount:proof?.totalDrafts??null,canCheck:!!window,needsRefresh});
}
