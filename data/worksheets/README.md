# Worksheet submission import

This folder holds the two CSV exports used by `scripts/import-worksheet-submissions.mjs`
to backfill historical worksheet data (who submitted, who didn't) into Supabase.
Both CSVs are gitignored (`*.csv`) since the detail file contains student names —
they only need to exist locally when you run the import.

- `SVM_Worksheet_Summary_By_Assignment.csv` — already here. One row per worksheet
  (59 total), used to create the `assignments` rows.
- `SVM_Worksheet_Submissions_Merged.csv` — **you need to add this one.** Save your
  original per-student export here (same file you already have — it has columns
  `Worksheet_Topic, Class, Student_Name, Submission_Status, Marks_Obtained, ...`).

See `scripts/import-worksheet-submissions.mjs` for the full run instructions
(migrations to apply first, then `--dry-run`, then the real run).
