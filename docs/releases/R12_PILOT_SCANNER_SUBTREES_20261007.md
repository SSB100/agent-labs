# Bounded pilot scanner delegation

Migration: `20261007114310_r12_pilot_scanner_subtrees.sql`.

## Preserved contract

Only `private.r12_pilot_safe(jsonb)` changes. The released `r04_safe` credential
rules, all root/scalar bounds, function permissions, owner, volatility, security
mode and search path remain unchanged. No validation result is persisted or
accepted from a caller. No outer dispatch lock, gate, profile check, timestamp
check or spending constraint is removed.

The scanner delegates a subtree of at most **19,997 serialized bytes** to the
unchanged recursive `r04_safe`. A null-valued key wrapper can be three bytes
larger than the same key paired with a one-byte scalar, so this reserve preserves
the original 20,000-byte wrapper bound. Larger containers keep the released
key-wrapper and recursive pilot traversal. The pilot root limit stays 65,536
bytes. This is traversal reuse, not a credential-filter relaxation.

Installation pins both fully migrated scanner bodies by SHA-256 and checks their
language, return type, volatility, parallel/strict/security properties, search
path and private ACLs. Unexpected body or permission changes fail closed before
replacement. `r04_safe` is not replaced.

## Measured recovery path

The same representative recovery fixture and reserved attempt were used for
both implementations, with real anonymous controller SQL, a three-second
statement timeout, and rollback between trials. No measured trial calls a
provider or commits a dispatch marker.

| Recovery dispatch | Before | Delegation |
| --- | ---: | ---: |
| First call after plan invalidation | 1,902 ms | 1,675 ms |
| Warm call | 1,773 ms | 1,560 ms |
| Pilot scanner time, first / warm | 568 / 534 ms | 353 / 330 ms |
| r04 wrapper/recursive calls | 57,607 | 30,790 |

All keys and scalar values remain checked by `r04_safe`; fewer function calls
reflect removal of redundant wrapper traversal. All seven outer scope checks,
three controller gates and **35 profile validations** remain. Four current-time
and caller-effective-time checks cover both abandoned and charged predecessors.
All 14 recovery integrity/security guards passed, followed by the complete
synthetic strategy/reviewer TEST lifecycle and root-uniqueness assertions.

The roughly 12% local dispatch reduction does not prove production timing. The
existing production seven-source historical read took about 2.527 seconds, and
a read-only five-profile proxy exceeded three seconds before unsent ledger work.
A real-host partial comparison remains required before paid activation; even a
passing partial read is not a whole-controller production dispatch guarantee.

## Security and regression verification

- Fully migrated native PostgreSQL parity: **354 cases**, including 267 rejected
  payloads; ordinary cases preserve exact acceptance/error results
- Escaped quotes/backslashes/control characters and multibyte keys around
  19,997, 19,998 and 20,000 bytes; scalar 20 KB and aggregate 64 KB boundaries
- Every released credential-pattern family at scalar, nested and boundary
  positions
- Deep resource probes at depths 16, 64, 128 and 256: both implementations
  accepted all four on the tested native PostgreSQL configuration
- Deliberate r04/pilot body drift and an unexpected API grant: installation
  rejected; catalog/ACL/owner/security/volatility/search-path equality verified
- Focused creative and scanner unit tests: **29 passed**
- Targeted lint and diff checks passed

The bounded parity helper runs within the existing isolated R12 setup, after
all migrations, with no extra database or role bootstrap. Its temporary test
definitions and drift probes are rolled back. Because the scanner is shared by
focused creative scope, wire and receipt validators, the unchanged complete
legacy creative SQL lifecycle remains an explicit canonical hosted gate. Local
large-image replay was not repeated after previously observed executor SIGKILL;
hosted SQL creative acceptance is pending at this local checkpoint.
