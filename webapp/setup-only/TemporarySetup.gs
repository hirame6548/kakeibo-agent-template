/* EDITOR SETUP ONLY. Remove this entire file after initialization, BEFORE any deployment.
 * Not part of gas/ runtime files. Never invoke from a browser or add it to a published app.
 * Authentication, valid mode, fixed target, lock, existing-ledger and empty-sheet checks
 * are all performed by initializeLedger_(); there is no alternate write path here.
 */
function setupLedgerOnce() {
  return initializeLedger_();
}
