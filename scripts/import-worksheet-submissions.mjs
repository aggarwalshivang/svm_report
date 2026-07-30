// One-off importer for historical worksheet data exported from Google Sheets
// (SVM_Worksheet_Summary_By_Assignment.csv + SVM_Worksheet_Submissions_Merged.csv).
//
// For every unique Sheet_ID in the summary CSV, creates one row in
// public.assignments (marked completed + submissions_closed, since these are
// historical/already-graded worksheets, not open assignments). For every
// "Submitted" row in the detail CSV, resolves the student against
// public.student_emails and upserts a row into public.assignment_submissions
// so the Teacher/Student dashboards show correct Submitted/Missing status.
//
// PREREQUISITE — run these two migrations in the Supabase SQL Editor first
// (they exist in this folder but were never applied to the live project):
//   1. scripts/add-portion-folder-to-assignments.sql
//   2. scripts/create-assignment-submissions-table.sql
//
// Usage:
//   SUPABASE_SERVICE_ROLE_KEY=<service role key> node scripts/import-worksheet-submissions.mjs
//
// Optional flags:
//   --summary=<path>   defaults to data/worksheets/SVM_Worksheet_Summary_By_Assignment.csv
//   --detail=<path>    defaults to data/worksheets/SVM_Worksheet_Submissions_Merged.csv
//   --dry-run          parse + match everything, print the report, write nothing to Supabase
//
// Re-running is safe: assignments are matched by drive_folder_id (skipped if
// already present) and submissions are upserted on (assignment_id, student_id).

import { createClient } from '@supabase/supabase-js'
import { readFile, writeFile, access } from 'node:fs/promises'
import path from 'node:path'

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://cexbpkbadthoqbruyjdg.supabase.co'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const DRY_RUN = process.argv.includes('--dry-run')

const argFlag = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}
const SUMMARY_PATH = argFlag('summary', 'data/worksheets/SVM_Worksheet_Summary_By_Assignment.csv')
const DETAIL_PATH = argFlag('detail', 'data/worksheets/SVM_Worksheet_Submissions_Merged.csv')

if (!SERVICE_ROLE_KEY && !DRY_RUN) {
  console.error('Missing SUPABASE_SERVICE_ROLE_KEY env var (required to bypass RLS for writes).')
  console.error('Get it from Supabase Dashboard -> Project Settings -> API -> service_role key.')
  console.error('Or pass --dry-run to parse/match the CSVs without connecting to Supabase.')
  process.exit(1)
}

const supabase = DRY_RUN
  ? null
  : createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })

// ── tiny RFC4180-ish CSV parser (handles quoted fields with embedded commas) ─
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

function humanizeTitle(topic) {
  return topic
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+,/g, ',')
    .trim()
}

const SCIENCE_KEYWORDS = [
  'motion', 'light', 'mirror', 'lens', 'acid', 'base', 'salt', 'tissue', 'describing motion',
]
function guessSubject(title) {
  const t = title.toLowerCase()
  return SCIENCE_KEYWORDS.some((k) => t.includes(k)) ? 'Science' : 'Maths'
}

function levenshtein(a, b) {
  const m = a.length, n = b.length
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)])
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1])
    }
  }
  return dp[m][n]
}

async function main() {
  for (const p of [SUMMARY_PATH, DETAIL_PATH]) {
    try {
      await access(p)
    } catch {
      console.error(`Can't find ${p}.`)
      if (p === DETAIL_PATH) {
        console.error(
          'Save your original SVM_Worksheet_Submissions_Merged.csv export to that path ' +
          '(or point at it with --detail=<path>) before running this script.'
        )
      }
      process.exit(1)
    }
  }

  console.log(`Reading ${SUMMARY_PATH} and ${DETAIL_PATH}…`)
  const [summaryText, detailText] = await Promise.all([
    readFile(SUMMARY_PATH, 'utf8'),
    readFile(DETAIL_PATH, 'utf8'),
  ])
  const summaryRows = parseCsv(summaryText)
  const detailRows = parseCsv(detailText)
  console.log(`  ${summaryRows.length} assignments in summary, ${detailRows.length} detail rows.\n`)

  // ── student roster (read-only; anon key or service role both work) ───────
  const rosterClient = DRY_RUN
    ? createClient(SUPABASE_URL, process.env.SUPABASE_ANON_KEY || SERVICE_ROLE_KEY || '')
    : supabase
  let studentRows = []
  if (rosterClient) {
    const { data, error } = await rosterClient
      .from('student_emails')
      .select('student_id, student_name, class')
    if (error) throw new Error(`Failed to load student_emails: ${error.message}`)
    studentRows = data
  }
  const studentMap = new Map() // `${class}|${normName}` -> {student_id, student_name}
  const rosterNamesByClass = { 9: [], 10: [] }
  for (const s of studentRows) {
    const key = `${s.class}|${normName(s.student_name)}`
    if (!studentMap.has(key)) studentMap.set(key, { student_id: s.student_id, student_name: s.student_name })
    if (rosterNamesByClass[s.class]) rosterNamesByClass[s.class].push(s.student_name)
  }
  console.log(`Loaded ${studentMap.size} distinct (class, student) roster entries.\n`)

  // ── build/insert assignments, one per Sheet_ID ────────────────────────────
  // Fabricate a chronological created_at/deadline from Sheet_Sequence so
  // worksheets keep their original relative order in the dashboard — adjust
  // afterwards in Supabase if you know the real dates.
  const maxSeq = Math.max(...summaryRows.map((r) => Number(r.Sheet_Sequence)))
  const baseDate = new Date()
  baseDate.setDate(baseDate.getDate() - maxSeq) // oldest sequence lands ~maxSeq days ago
  const dateForSeq = (seq) => {
    const d = new Date(baseDate)
    d.setDate(d.getDate() + Number(seq))
    return d.toISOString()
  }

  const sheetIdToAssignmentId = new Map()
  let createdCount = 0
  let skippedCount = 0

  for (const row of summaryRows) {
    const sheetId = row.Sheet_ID
    const title = humanizeTitle(row.Worksheet_Topic) +
      (row.Topic_Occurrence && row.Topic_Occurrence !== '1 of 1' ? ` (Part ${row.Topic_Occurrence})` : '')
    const klass = row.Class
    const subject = guessSubject(row.Worksheet_Topic)
    const when = dateForSeq(row.Sheet_Sequence)
    const notes =
      `Imported from historical worksheet tracker. Submission rate ${row.Submission_Rate_Percent}% ` +
      `(${row.Submitted_Count}/${row.Total_Tracked} tracked). Non-submitter identity: ${row.Non_Submitter_Identity}.`

    if (DRY_RUN) {
      sheetIdToAssignmentId.set(sheetId, `dry-run-${sheetId}`)
      createdCount++
      continue
    }

    const { data: existing, error: findErr } = await supabase
      .from('assignments')
      .select('id')
      .eq('drive_folder_id', sheetId)
      .maybeSingle()
    if (findErr) throw new Error(`Lookup failed for sheet ${sheetId}: ${findErr.message}`)

    if (existing) {
      sheetIdToAssignmentId.set(sheetId, existing.id)
      skippedCount++
      continue
    }

    const { data: inserted, error: insErr } = await supabase
      .from('assignments')
      .insert({
        class: klass,
        subject,
        title,
        portion: title,
        drive_folder_id: sheetId,
        deadline: when,
        created_at: when,
        notes,
        completed: true,
        submissions_closed: true,
      })
      .select('id')
      .single()
    if (insErr) throw new Error(`Insert failed for sheet ${sheetId} (${title}): ${insErr.message}`)

    sheetIdToAssignmentId.set(sheetId, inserted.id)
    createdCount++
  }
  console.log(`Assignments: ${createdCount} created, ${skippedCount} already existed.\n`)

  // ── walk detail rows, resolve students, build submission upserts ─────────
  const submissionsByKey = new Map() // `${assignment_id}|${student_id}` -> row
  const unmatched = new Map() // `${class}|${name}` -> count
  let submittedSeen = 0

  for (const row of detailRows) {
    if (row.Submission_Status !== 'Submitted') continue
    submittedSeen++

    const assignmentId = sheetIdToAssignmentId.get(row.Sheet_ID)
    if (!assignmentId) continue // shouldn't happen — every Sheet_ID comes from the summary CSV

    const klass = row.Class
    const key = `${klass}|${normName(row.Student_Name)}`
    const student = studentMap.get(key)
    if (!student) {
      const uKey = `${klass}|${row.Student_Name}`
      unmatched.set(uKey, (unmatched.get(uKey) || 0) + 1)
      continue
    }

    const subKey = `${assignmentId}|${student.student_id}`
    if (!submissionsByKey.has(subKey)) {
      submissionsByKey.set(subKey, {
        assignment_id: assignmentId,
        student_id: student.student_id,
        student_name: student.student_name,
        submitted_at: dateForSeq(row.Sheet_Sequence),
      })
    }
  }

  console.log(`Detail rows marked "Submitted": ${submittedSeen}`)
  console.log(`Resolved to ${submissionsByKey.size} distinct (assignment, student) submissions.`)
  console.log(`Unmatched student names (couldn't find in student_emails for that class): ${unmatched.size}\n`)

  if (unmatched.size) {
    console.log('── Unmatched names — check for typos/aliases against the roster ──')
    for (const [uKey, count] of unmatched) {
      const [klass, name] = uKey.split('|')
      const candidates = (rosterNamesByClass[klass] || [])
        .map((n) => ({ n, d: levenshtein(normName(name), normName(n)) }))
        .filter((c) => c.d > 0 && c.d <= 3)
        .sort((a, b) => a.d - b.d)
        .slice(0, 3)
      const suggestion = candidates.length
        ? ` -> possible match: ${candidates.map((c) => `"${c.n}" (edit distance ${c.d})`).join(', ')}`
        : ' -> no close match in roster'
      console.log(`  Class ${klass} "${name}" (${count} worksheet${count === 1 ? '' : 's'})${suggestion}`)
    }
    console.log()
  }

  // ── write the report either way (useful even for --dry-run) ──────────────
  const report = {
    generated_at: new Date().toISOString(),
    dry_run: DRY_RUN,
    assignments_created: createdCount,
    assignments_already_existed: skippedCount,
    submitted_rows_seen: submittedSeen,
    submissions_to_write: submissionsByKey.size,
    unmatched_names: Object.fromEntries(unmatched),
  }
  const reportPath = path.join(path.dirname(SUMMARY_PATH), 'import-report.json')
  await writeFile(reportPath, JSON.stringify(report, null, 2))
  console.log(`Report written to ${reportPath}`)

  if (DRY_RUN) {
    console.log('\n--dry-run set: nothing was written to Supabase.')
    return
  }

  // ── upsert submissions in batches ─────────────────────────────────────────
  const submissions = [...submissionsByKey.values()]
  const BATCH = 500
  let written = 0
  for (let i = 0; i < submissions.length; i += BATCH) {
    const batch = submissions.slice(i, i + BATCH)
    const { error } = await supabase
      .from('assignment_submissions')
      .upsert(batch, { onConflict: 'assignment_id,student_id' })
    if (error) throw new Error(`Upsert failed on batch starting at ${i}: ${error.message}`)
    written += batch.length
    console.log(`  upserted ${written}/${submissions.length} submissions…`)
  }

  console.log('\nDone. Refresh the Teacher/Student dashboards to see the imported worksheets.')
}

main().catch((err) => {
  console.error('\nImport failed:', err.message)
  process.exit(1)
})
