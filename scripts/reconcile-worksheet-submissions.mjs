// Reconciles assignment_submissions for the 59 historical worksheets in
// SVM_Worksheet_Summary_By_Assignment.csv back to ground truth from
// SVM_Worksheet_Submissions_Merged.csv -- the same two CSVs
// import-worksheet-submissions.mjs used to create those worksheets and their
// real submissions in the first place (see data/worksheets/import-report.json).
//
// Why this is needed: scripts/backfill-all-missing-submissions.sql, run
// afterwards, topped up every worksheet with <=10 real submissions to a full
// "everyone submitted" state by inserting one assignment_submissions row per
// missing (assignment_id, student_id) pair. It never deletes or overwrites
// anything, so every row the original import wrote is still there untouched
// -- but so is a fake row for every real non-submitter on any of those
// low-count worksheets. There's no stored column that tells a real row from
// a padded one (both share the same student_name source and the same
// submitted_at formula), so the only reliable way back is re-matching
// against the original detail CSV, exactly like the import did.
//
// This script does NOT touch the database. It reads the two CSVs, reads the
// current DB state (assignments + assignment_submissions) via the service
// role key, computes exactly which currently-stored rows on the 59 matched
// worksheets are NOT a real "Submitted" row in the detail CSV, and writes a
// ready-to-run SQL file that deletes precisely those rows.
//
// Worksheets that aren't in the summary CSV (i.e. weren't created by the
// historical import -- newer digitally-tracked worksheets) are never
// considered at all, matched or not.
//
// Usage:
//   SUPABASE_SERVICE_ROLE_KEY=<service role key> node scripts/reconcile-worksheet-submissions.mjs
//
// Then review scripts/reconcile-worksheet-submissions.sql and run it once in
// the Supabase Dashboard -> SQL Editor.

import { createClient } from '@supabase/supabase-js'
import { readFile, writeFile } from 'node:fs/promises'

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://cexbpkbadthoqbruyjdg.supabase.co'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const SUMMARY_PATH = 'data/worksheets/SVM_Worksheet_Summary_By_Assignment.csv'
const DETAIL_PATH = 'data/worksheets/SVM_Worksheet_Submissions_Merged.csv'
const OUT_PATH = 'scripts/reconcile-worksheet-submissions.sql'

if (!SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_SERVICE_ROLE_KEY env var (required to read the real DB state and bypass RLS).')
  console.error('Get it from Supabase Dashboard -> Project Settings -> API -> service_role key.')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })

// ── same RFC4180-ish CSV parser + name normalizer as import-worksheet-submissions.mjs ──
function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false
  const pushField = () => { row.push(field); field = '' }
  const pushRow = () => { pushField(); rows.push(row); row = [] }

  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else { inQuotes = false }
      } else {
        field += c
      }
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      pushField()
    } else if (c === '\n') {
      if (field.endsWith('\r')) field = field.slice(0, -1)
      pushRow()
    } else {
      field += c
    }
  }
  if (field.length || row.length) pushRow()

  const header = rows[0].map((h) => h.replace(/^﻿/, '').trim())
  return rows.slice(1)
    .filter((r) => r.length > 1 || r[0] !== '')
    .map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])))
}

function normName(name) {
  return name.toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim()
}

function sqlEscape(s) {
  return s.replace(/'/g, "''")
}

async function main() {
  console.log(`Reading ${SUMMARY_PATH} and ${DETAIL_PATH}…`)
  const [summaryText, detailText] = await Promise.all([
    readFile(SUMMARY_PATH, 'utf8'),
    readFile(DETAIL_PATH, 'utf8'),
  ])
  const summaryRows = parseCsv(summaryText)
  const detailRows = parseCsv(detailText)
  const sheetIds = [...new Set(summaryRows.map((r) => r.Sheet_ID))]
  console.log(`  ${sheetIds.length} worksheets in the summary CSV, ${detailRows.length} detail rows.\n`)

  // Sheet_ID -> assignment_id (uuid), same correlation the original import used.
  const { data: assignments, error: aErr } = await supabase
    .from('assignments')
    .select('id, drive_folder_id, title, deadline')
    .in('drive_folder_id', sheetIds)
  if (aErr) throw new Error(`Failed to load assignments: ${aErr.message}`)
  const assignmentIdBySheetId = new Map(assignments.map((a) => [a.drive_folder_id, a.id]))
  const missingSheetIds = sheetIds.filter((id) => !assignmentIdBySheetId.has(id))
  if (missingSheetIds.length) {
    console.warn(`Warning: ${missingSheetIds.length} Sheet_ID(s) from the summary CSV have no matching assignment in the DB (drive_folder_id) -- skipped:`)
    console.warn(missingSheetIds)
  }
  const matchedAssignmentIds = [...assignmentIdBySheetId.values()]
  console.log(`${matchedAssignmentIds.length} worksheets matched to a live assignment row.\n`)

  // Roster, keyed the same way the original import resolved names.
  const { data: students, error: sErr } = await supabase
    .from('student_emails')
    .select('student_id, student_name, class')
  if (sErr) throw new Error(`Failed to load student_emails: ${sErr.message}`)
  const studentMap = new Map()
  for (const s of students) {
    const key = `${s.class}|${normName(s.student_name)}`
    if (!studentMap.has(key)) studentMap.set(key, s.student_id)
  }

  // Ground truth: every detail row marked "Submitted" that resolves to a real roster student.
  const trueSubmitters = new Set()
  let unresolved = 0
  for (const row of detailRows) {
    if (row.Submission_Status !== 'Submitted') continue
    const assignmentId = assignmentIdBySheetId.get(row.Sheet_ID)
    if (!assignmentId) continue
    const studentId = studentMap.get(`${row.Class}|${normName(row.Student_Name)}`)
    if (!studentId) { unresolved++; continue }
    trueSubmitters.add(`${assignmentId}|${studentId}`)
  }
  console.log(`${trueSubmitters.size} real submissions resolved from the detail CSV (${unresolved} "Submitted" rows couldn't be matched to a roster student -- same class of unmatched names the original import reported).\n`)

  // Current DB state for the matched worksheets only.
  const { data: currentSubs, error: cErr } = await supabase
    .from('assignment_submissions')
    .select('assignment_id, student_id')
    .in('assignment_id', matchedAssignmentIds)
  if (cErr) throw new Error(`Failed to load assignment_submissions: ${cErr.message}`)

  const currentKeySet = new Set(currentSubs.map((s) => `${s.assignment_id}|${s.student_id}`))
  const extras = currentSubs.filter((s) => !trueSubmitters.has(`${s.assignment_id}|${s.student_id}`))
  const missingKeys = [...trueSubmitters].filter((k) => !currentKeySet.has(k))

  console.log(`${currentSubs.length} current submission rows across the ${matchedAssignmentIds.length} matched worksheets.`)
  console.log(`${extras.length} of those aren't a real "Submitted" row in the detail CSV -- synthetic padding to delete.`)
  console.log(`${missingKeys.length} real "Submitted" rows from the detail CSV have NO row in the database at all -- these need to be inserted (most likely the original 2026-08-02 import didn't finish writing all of its batches).\n`)

  if (extras.length === 0 && missingKeys.length === 0) {
    console.log('Nothing to reconcile -- matched worksheets already reflect their real submission data. No SQL file written.')
    return
  }

  const deadlineByAssignmentId = new Map(assignments.map((a) => [a.id, a.deadline]))
  const studentNameById = new Map(students.map((s) => [s.student_id, s.student_name]))
  const sheetIdList = sheetIds.map((id) => `'${sqlEscape(id)}'`).join(', ')

  const deleteSql = extras.length
    ? `-- 1) Remove the ${extras.length} synthetic row(s) scripts/backfill-all-missing-submissions.sql
--    padded in for students who were NOT actually marked "Submitted" for
--    that worksheet in the detail CSV.
delete from public.assignment_submissions t
using (values
${extras.map((e) => `  ('${e.assignment_id}'::uuid, ${e.student_id})`).join(',\n')}
) as extra(assignment_id, student_id)
where t.assignment_id = extra.assignment_id and t.student_id = extra.student_id;
`
    : '-- No synthetic rows to remove -- every current row on a matched worksheet is a real submission.\n'

  const insertSql = missingKeys.length
    ? `-- 2) Insert the ${missingKeys.length} real submission(s) from the detail CSV that have
--    no row in the database at all. Backdated to each worksheet's own
--    deadline -- the same convention already used for every other
--    historical/backfilled row in this table -- so nothing reads as late.
insert into public.assignment_submissions (assignment_id, student_id, student_name, submitted_at)
values
${missingKeys.map((k) => {
      const sep = k.indexOf('|')
      const assignmentId = k.slice(0, sep)
      const studentId = Number(k.slice(sep + 1))
      const name = studentNameById.get(studentId) ?? ''
      const deadline = deadlineByAssignmentId.get(assignmentId)
      return `  ('${assignmentId}'::uuid, ${studentId}, '${sqlEscape(name)}', '${deadline}'::timestamptz)`
    }).join(',\n')}
on conflict (assignment_id, student_id) do nothing;
`
    : '-- No missing real submissions -- every "Submitted" row in the detail CSV already has a matching database row.\n'

  const sql = `-- Auto-generated by scripts/reconcile-worksheet-submissions.mjs -- do not hand-edit, regenerate instead.
-- Run this once in the Supabase Dashboard -> SQL Editor.
--
-- Brings assignment_submissions for the ${matchedAssignmentIds.length} worksheet(s) matched against
-- SVM_Worksheet_Summary_By_Assignment.csv / SVM_Worksheet_Submissions_Merged.csv
-- back to exactly what those CSVs say happened: ${extras.length} synthetic row(s)
-- removed, ${missingKeys.length} real row(s) that were never written inserted.
-- Worksheets outside that matched set are never referenced and are left
-- exactly as they currently are.

${deleteSql}
${insertSql}
-- Sanity check: matched worksheets' submission counts should now equal
-- Submitted_Count from SVM_Worksheet_Summary_By_Assignment.csv.
select a.id, a.title, a.drive_folder_id,
  (select count(*) from public.assignment_submissions s where s.assignment_id = a.id) as submission_count
from public.assignments a
where a.drive_folder_id in (${sheetIdList})
order by a.title;
`

  await writeFile(OUT_PATH, sql)
  console.log(`Wrote ${OUT_PATH}.`)
  console.log('Review it, cross-check a couple of rows against the summary CSV\'s Submitted_Count, then run it once in the Supabase Dashboard -> SQL Editor.')
}

main().catch((err) => {
  console.error('\nReconcile failed:', err.message)
  process.exit(1)
})
