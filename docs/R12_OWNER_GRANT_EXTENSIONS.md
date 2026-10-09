# Explicit increases to a consumed research allowance

Status: local correction in progress. No production migration, new enrollment or live episode is completed by this record.

The first real owner continuation used its one-episode grant and then stopped after the independent review response failed validation. The reviewer prompt correction was released in PR79, but the next owner journey exposed a second gap: the original grant root is immutable, permits only one scope, and has no approval revision mechanism. A new bootstrap grant cannot increase that root. Creating a different funding binding or grant root would discard the intended cumulative boundary.

The correction adds explicit, immutable revisions of the **same grant root**. Each revision records its exact predecessor hash, cumulative scope and allocation limits, finite expiry and approval evidence. A new continuation grant binds to one exact revision and hash. Old grants retain their original limits; they never inherit the latest revision. This does not increase the original research funding root or the Business spending limit.

The normal owner preparation packet displays the bound approval revision. Its saved hash includes that reference. Confirmation checks the same current revision while holding the original root lock, alongside the existing predecessor closure, cumulative allocations, funding and lifetime counters. A changed approval requires a new packet. Activated historical receipts retain their original references even after expiry or a later revision.

Extension-backed grants are continuation-only. They cannot authorize a new initial Goal or bypass the one-successor-per-predecessor rule. Stop still consumes the activated allocation before the first call. Known charges, late receipts and all historical root and Goal identities remain preserved. The five-phase engine and its output validation are unchanged.

## Qualification

Required checks include a genuinely consumed one-scope root; explicit extension of that same root; unchanged old grants and historical records; forged root/revision/hash rejection; unauthorized insertion and modification; stale confirmation; atomic rollback; concurrent confirmation and Stop; native and legacy funding; and normal browser confirmation, reload, history, mobile, keyboard and 200% zoom. The browser path must still make exactly five inert calls and one collection. Final exact-tree hosted qualification and independent review remain required before release.

This is a general correction to finite approval handling. It creates no production allowance by itself. Another live episode requires a current reviewed profile, an exact finite grant revision, genuine R05 confirmation and sufficient approved financial headroom. A valid NEEDS_MORE_EVIDENCE result can qualify the owner research journey but does not fulfill production-purpose creative qualification. That exit still requires a supported TEST and its own bounded creative authority.
