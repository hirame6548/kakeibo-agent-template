# Release status and remaining checks

## Code-only developer preview

This candidate integrates the fixed confirmation/source-evidence worker with the complete app sources and a mandatory actual-clock check at the public confirm entry point. Source integration does not imply deployment parity or real-service validation.

Before publication, the owner must:

- Review the final test report, archive member allowlist and secret/personal-data scan for the exact release artifact. Test commands in README describe reproducible checks, not a claim that every possible environment has passed.
- Retain the owner-approved MIT copyright notice for hirame6548. The display name is confirmed. Historical provenance has not been independently established for every source line, while the prior unattributed icon paths have been removed and replaced as documented in docs/UI-PROVENANCE.md.
- Accept the explicitly limited developer-preview scope and perform final repository creation/publication/sharing themselves.

The current regression suite includes the observed-clock guard locally. One optional historical check that reproduces a former confirm implementation's schema1 failure is not shipped or run because that former source is outside this distribution. Current schema1/schema2 confirmation behavior has its own synthetic regression cases. Do not claim the complete historical source-comparison suite ran.

## Not yet a demonstrated deployment path

These items do not prevent studying the code or running the offline demo, but they do prevent claiming a ready-to-run personal deployment:

- A general Gmail/Drive connector and scheduled-agent adapter are contracts, not shipped working integrations. Validate trusted acquisition, permissions, storage and private transport in the user's environment.
- Fresh-account OAuth, owner-only GAS deployment, real Sheets/Drive roundtrips and scheduled execution have not been demonstrated for this public configuration.
- Browser/mobile behavior in a fresh deployed environment remains unverified.
- Each new provider, category-policy change or timezone adaptation needs representative sanitized fixtures, regression tests and staged verification.
- Before real intake, require an empty isolated demo, permission review, bootstrap/canary and complete revision-stable readback. A UI deployment version alone is not proof of the runtime HEAD capability.

No production access is needed for the public offline checks. Do not test this preview against an existing personal ledger by default.
