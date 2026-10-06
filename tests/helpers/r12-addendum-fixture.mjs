import { createHash } from 'node:crypto';
const hash = text => createHash('sha256').update(text).digest('hex');
export function r12AddendumFixture(intent, now) {
  const context = 'Synthetic catalogue observation: an original adult cotton nature T-shirt is offered at a stated asking price. This is one current offer, not sales or representative buyer demand.';
  return { version: 'r12.discovery-evidence-addendum.1', id: '77777777-7777-4777-8777-777777777777', businessId: intent.businessId,
    goalId: '88888888-8888-4888-8888-888888888888', predecessorScopeId: '99999999-9999-4999-8999-999999999999', predecessorReviewHash: '9'.repeat(64),
    observations: [{ id: `evi-${'1'.repeat(24)}`, sourceId: `src-${'2'.repeat(24)}`, url: 'https://example.org/nature-shirt', title: 'Synthetic nature shirt offer',
      access: 'public_document_read', kind: 'retail_offer', retrievedAt: new Date(now - 60_000).toISOString(), expiresAt: new Date(now + 60 * 60_000).toISOString(), captureHash: '3'.repeat(64), contentHash: hash(context), context, start: 0, end: Array.from(context).length,
      geographyRole: 'buyer_market', countries: ['US'], dimensions: ['competition', 'differentiation'], limitations: ['One synthetic listed offer cannot establish sales, demand, conversion, or a representative price distribution.'], sourceReviewHash: '4'.repeat(64) }],
    sellerBankCountry: null, approvalHash: '5'.repeat(64), independentReviewHash: '6'.repeat(64), createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 60 * 60_000).toISOString() };
}
