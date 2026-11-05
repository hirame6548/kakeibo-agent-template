# Privacy and reporting

Keep real email, raw MIME, CSV exports, ledger snapshots, account details, tokens and local profiles outside Git, archives and public issue reports. The bundled fixtures are synthetic. A file's `provenance` label is not proof that its bytes came from Gmail: the adapter must establish the trusted acquisition boundary.

For a bug report, reproduce it with synthetic data and share only the minimal code path, version, sanitized error code and synthetic fixture. Never paste a production payload or authentication header into a public issue. No private security reporting channel is established by this preview; do not post secrets while seeking support.

The only supported worker entry point is `python3 worker/cloud_entry.py`. Its prepare and validate operations are offline. Transport must use its unmodified successful validate output, and completion must use its confirm operation. Internal Node helpers and legacy rejection fixtures are not alternative public runtime entry points. All real authentication, deployment and scheduled operation require user authorization and an independently verified adapter.

Manifest hashes detect accidental source drift; they are not a cryptographic publisher signature and do not prove the origin of downloaded code. Review source and acquire releases from an independently verified owner before using real data.
