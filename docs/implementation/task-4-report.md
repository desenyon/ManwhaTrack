# Task 4 — Manual fallback and durable chapter corrections

Implemented title/source/status fallback with immutable IDs and no invented reading evidence. Existing canonical URLs restore the existing series without replacing its metadata. Chapter moves preserve the original URL/ID, progress, counters and linked events in one transaction, update both summaries, increment the progress revision, and notify live readers after commit.

A move reuses a source on the actual chapter hostname. If none exists, it retains the only known chapter address as an inferred source and disables update checks until corrected. A destination already containing the same canonical chapter is rejected without writes and directs the user to the existing series merge workflow.

`associationOverridden` records the user's explicit ownership choice. Automatic observation/list refresh preserves it; a removed corrected series is restored on revisit; live content re-detects changed tab ownership and resumes on the corrected series. Merge retains explicit imported chapter labels/numbers when locally unowned; Replace applies imported corrections. Source merges preserve absorbed correction markers.

Database/export version 3 migrates old records without deletion. Combined chapter migration avoids competing upgrade cursors overwriting revision/association changes during a direct 1-to-3 upgrade. Versions 1 and 2 backups repair into the current schema.

Verification: 15 manual storage regressions passed, including safe input, duplicate URL, user metadata, transaction/history preservation, repeated discovery, full export/restore, Merge/Replace marker and label corrections, source merge, conflicting destination, and removed-series restore. Migration tests cover direct 1-to-3 and 2-to-3 preservation. A content lifecycle regression verifies active readers re-detect after reassociation. UI evidence is in task-4-ui-report.md; final browser evidence is recorded separately in verification.md.
