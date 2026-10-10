// Inert owner-view scope; no provider transport or private session state.
export const contracts=await import('../../.core-tests/accounts/etsy-steel-handoff-contracts.js');
const NOW=Date.parse('2026-10-10T11:30:00Z');
export const id=n=>`20000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const H=n=>n.toString(16).padStart(64,'0');
export const hash=contracts.etsySteelHash;
export function scope(changes={}){
 const s={version:contracts.ETSY_STEEL_HANDOFF_VERSION,operationId:id(1),ownerId:id(2),businessId:id(3),goalId:id(4),authorityRootId:id(5),
  testEnvelopeId:id(10),testEnvelopeHash:H(10),providerProjectId:id(11),
  verificationOperationId:id(12),verificationMaximumMicrounits:'10000',verificationQuoteHash:H(12),
  accountId:id(6),accountRevision:id(7),expectedShopName:'Synthetic Owner Shop',expectedShopId:'98765',purpose:'etsy_insights_read_only',
  approvalId:id(8),approvalRevision:id(9),approvedAt:new Date(NOW-1000).toISOString(),approvalExpiresAt:new Date(NOW+900000).toISOString(),
  profileAccessExpiresAt:new Date(NOW+86400000).toISOString(),maximumSessionMs:60000,maximumBrowserMicrounits:'20000',currency:'USD',quoteHash:H(1),...changes};
 return {...s,disclosureHash:hash(contracts.buildEtsySteelHandoffDisclosure(s))};
}
