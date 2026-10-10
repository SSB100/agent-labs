/** Explicit inert renderer review; never enroll a production route. */
import {discoveryV2Hash as hash} from '../../.core-tests/products/discovery-v2-hash.js';
export const inertOwnerRendererPolicy={version:'etsy.insights-renderer-policy.1',staticOrigins:[],maximumRequests:256,navigation:'fixed_insights_get_only',sameOrigin:'renderer_get_only',post:'denied',extraction:'visible_aggregate_dom_only'};
export async function qualifyInertOwnerRenderer(db,{routeHash,project,validFrom,validUntil,policy=inertOwnerRendererPolicy,verificationPolicy=inertOwnerRendererPolicy}){
 await db.query('insert into private.r12_direct_owner_renderer_reviews(route_hash,provider_project_id,policy,policy_hash,review_hash,valid_from,valid_until) values($1,$2,$3,$4,$5,$6,$7)',[routeHash,project,policy,hash(policy),hash({inertReview:routeHash}),validFrom,validUntil]);
 await db.query('insert into private.r12_direct_verification_renderer_reviews(route_hash,provider_project_id,policy,policy_hash,review_hash,valid_from,valid_until) values($1,$2,$3,$4,$5,$6,$7)',[routeHash,project,verificationPolicy,hash(verificationPolicy),hash({inertVerificationReview:routeHash}),validFrom,validUntil]);
 return {researchPins:{qualification:'inert-bootstrap-only'},profileTemplate:{qualification:'inert-bootstrap-only'}};
}
