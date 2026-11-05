# Design overview

## Why an agent-assisted ledger?

The owner used the ledger personally and improved it with an AI coding agent. The useful division of work is not “let a model edit a spreadsheet freely.” An agent can help understand a user's providers, propose categories and explain holds. Deterministic code owns parsing, safety checks and persistence contracts.

## Data flow

1. A user-authorized adapter retrieves complete Gmail raw messages and a revision-stable ledger snapshot.
2. Python decodes supported mail and verifies receiver-side authentication. Node plans intake without writing anything.
3. A model proposes classification or purchase details from permitted evidence. It does not invent authentication, IDs, amounts or input versions.
4. Python validate mechanically verifies source evidence and creates an immutable exchange plus confirmation expectations.
5. An authorized adapter delivers the exchange to the configured private inbox. GAS is the only ledger writer.
6. A fresh complete readback is checked against those expectations, the matching persisted receipt and the actual observation clock.

The shipped offline demo substitutes a local synthetic commit for steps involving Google. It does not supply a generic Gmail/Drive adapter or scheduler.

## Invariants

- Preserve existing financial fields, owner corrections, locks, notes, history and unknown columns.
- Hold ambiguous matches and stale proposals instead of guessing.
- Reserve evidence by mailbox/message and purchase root to prevent cross-purchase reuse.
- Make identical replay safe and reject changed content under the same run ID.
- Require an explicit successful receipt with the expected digest, capability and execution path.
- Do not call held, unsearched or merely planned output “saved.”
- Permit only specified commit-time changes, then reject invalid or future clocks using the executing process's actual time.

## Boundaries

Receiver authentication proves the provenance checked by the decoder, not the correctness of an AI's interpretation of a product. Human review remains useful. A successful notification is not proof that every expense was captured or that a card bill is final.

Provider formats, Japanese categories, UI frames and date conventions are implementation choices, not universal defaults. The config profile separates destination/owner/account choices, but does not turn unsupported providers into supported ones.

`SCHEMAS.json` is explanatory contract metadata. It is not a standard JSON Schema and must not be advertised as a substitute for executable validation.
