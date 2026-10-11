# One-use Steel metadata authorization

This additive release permits an operator-reviewed exception for one existing,
terminal Steel session metadata read. It does not renew the configured R05 root,
change historical R11 authority, create a browser session, or grant spending or
persistent Etsy access.

## Boundary

The private authorization pins one target, Business, current owner, Goal revision,
configured key digest, exact historical R11 policy, approval and review evidence.
Its validity is at most two hours and cannot exceed the target's validity. The
target binds the known session, provider project, production deployment and
configuration. No production identities, secret values or activation records are
included in this release.

Only the existing owner-and-key-gated metadata RPC can consume it. Registry
membership, global revocation and delegated-key exclusions remain mandatory.
One immutable claim allows at most one fixed GET, with a maximum 20-second claim
window. Failure, cancellation, lost acknowledgment or timeout cannot reset it.
Goal changes prevent a new acquisition without suppressing truthful completion
of an already authorized bounded observation. Expiry ends permission, not audit
retention. Revocation cannot recall a request that has already been sent.

The historical metadata path remains unchanged for targets without an exception.
All R05/R11 paid admission, funding, enrollment, handoff, verification and cleanup
contracts remain unchanged. Later login steps require their own existing reviewed
grant, envelope and purpose-key checks; this exception supplies none of them.

## Rollout and recovery

The migration installs definitions only. A separately reviewed private publisher
must activate an exact fresh target authorization after qualification. API roles
cannot read/write the authorization table or invoke its publisher. Existing
target revocation is the kill switch; the original root expiry is immutable.

Deploy and activate only after exact-commit required CI and independent boundary
review pass. Qualification must include the actual new migration, historical
regressions, native PostgreSQL lock races, authenticated PostgREST behavior and
the normal owner enrollment/handoff journey with an expired R11-bound root.
Controlled provider responses do not establish live Steel access.

Application rollback does not undo this database migration. Disable any remaining
target permission through its existing revocation path and preserve all immutable
claims, results and historical ledgers. No destructive rollback is provided.
