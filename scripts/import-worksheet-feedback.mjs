// One-off importer for historical per-submission feedback exported from
// Google Sheets/Forms (SVM_Homework_Feedback_Report.csv).
//
// For every row, upserts into public.worksheet_feedback:
//   - handwriting_feedback = "[Assignment Name, Class N, Subject] " + Handwriting
//   - assignment_feedback  = "[Assignment Name, Class N, Subject] " + What to Improve
// Students are resolved against public.student_emails by (class, normalized
// name); unmatched rows are still imported (student_id left null) so the
// feedback stays visible, but are listed in the report for manual cleanup.
//
// PREREQUISITE — run this migration in the Supabase SQL Editor first:
//   scripts/create-worksheet-feedback-table.sql
//
// Usage:
//   SUPABASE_SERVICE_ROLE_KEY=<service role key> node scripts/import-worksheet-feedback.mjs
//
// Optional flags:
//   --file=<path>   defaults to data/worksheets/SVM_Homework_Feedback_Report.csv
//   --dry-run       parse + match everything, print the report, write nothing to Supabase
//
// Re-running is safe: rows are upserted on (student_name, class,
// assignment_name, submitted_at), so identical re-imports overwrite in place.

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
const FILE_PATH = argFlag('file', 'data/worksheets/SVM_Homework_Feedback_Report.csv')

if (!SERVICE_ROLE_KEY && !DRY_RUN) {
  console.error('Missing SUPABASE_SERVICE_ROLE_KEY env var (required to bypass RLS for writes).')
  console.error('Get it from Supabase Dashboard -> Project Settings -> API -> service_role key.')
  console.error('Or pass --dry-run to parse/match the CSV without connecting to Supabase.')
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

// "23/05/26, 7:47 pm" (DD/MM/YY, h:mm am/pm, assumed IST) -> ISO timestamp.
// Google Forms/Sheets exports often use a narrow no-break space (U+202F)
// before am/pm; normalize any odd whitespace before matching.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000
function parseTimestamp(raw) {
  const cleaned = raw.replace(/[  ]/g, ' ').replace(/\s+/g, ' ').trim()
  const m = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}),\s*(\d{1,2}):(\d{2})\s*(am|pm)$/i)
  if (!m) return null
  const [, dd, mm, yy, hh, min, ap] = m
  const day = Number(dd)
  const month = Number(mm)
  const year = 2000 + Number(yy)
  let hour = Number(hh) % 12
  if (ap.toLowerCase() === 'pm') hour += 12
  const utcMs = Date.UTC(year, month - 1, day, hour, Number(min)) - IST_OFFSET_MS
  return new Date(utcMs).toISOString()
}

async function main() {
  try {
    await access(FILE_PATH)
  } catch {
    console.error(`Can't find ${FILE_PATH}.`)
    console.error('Save the feedback export there (or point at it with --file=<path>) before running this script.')
    process.exit(1)
  }

  console.log(`Reading ${FILE_PATH}…`)
  const text = await readFile(FILE_PATH, 'utf8')
  const rows = parseCsv(text)
  console.log(`  ${rows.length} feedback rows.\n`)

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
  const rosterNamesByClass = {}
  for (const s of studentRows) {
    const key = `${s.class}|${normName(s.student_name)}`
    if (!studentMap.has(key)) studentMap.set(key, { student_id: s.student_id, student_name: s.student_name })
    if (!rosterNamesByClass[s.class]) rosterNamesByClass[s.class] = []
    rosterNamesByClass[s.class].push(s.student_name)
  }
  console.log(`Loaded ${studentMap.size} distinct (class, student) roster entries.\n`)

  // ── build feedback rows ────────────────────────────────────────────────
  const feedbackByKey = new Map() // `${name}|${class}|${assignment}|${submitted_at}` -> row
  const unmatched = new Map() // `${class}|${name}` -> count
  const badTimestamps = []
  let skippedBlank = 0

  for (const row of rows) {
    const name = row.Name
    const klass = Number(row.Class)
    const assignmentName = row['Assignment Name']
    if (!name || !klass || !assignmentName) { skippedBlank++; continue }

    const submittedAt = parseTimestamp(row.Timestamp)
    if (!submittedAt) {
      badTimestamps.push(`${name} (${assignmentName}): "${row.Timestamp}"`)
      continue
    }

    const context = `[${assignmentName}, Class ${klass}, ${row.Subject}]`
    const handwritingFeedback = row.Handwriting ? `${context} ${row.Handwriting}` : null
    const assignmentFeedback = row['What to Improve'] ? `${context} ${row['What to Improve']}` : null

    const key = `${normName(name)}|${klass}|${assignmentName}|${submittedAt}`
    const studentKey = `${klass}|${normName(name)}`
    const student = studentMap.get(studentKey)
    if (!student) {
      const uKey = `${klass}|${name}`
      unmatched.set(uKey, (unmatched.get(uKey) || 0) + 1)
    }

    // Later rows with an identical key overwrite earlier ones, matching the
    // upsert's own (name, class, assignment, submitted_at) uniqueness.
    feedbackByKey.set(key, {
      student_id: student ? student.student_id : null,
      student_name: name,
      class: klass,
      subject: row.Subject,
      assignment_name: assignmentName,
      handwriting_feedback: handwritingFeedback,
      assignment_feedback: assignmentFeedback,
      submitted_at: submittedAt,
    })
  }

  console.log(`Parsed rows: ${rows.length}`)
  console.log(`Skipped (missing name/class/assignment): ${skippedBlank}`)
  console.log(`Skipped (unparseable timestamp): ${badTimestamps.length}`)
  console.log(`Distinct feedback rows to write: ${feedbackByKey.size}`)
  console.log(`Unmatched student names (couldn't find in student_emails for that class): ${unmatched.size}\n`)

  if (badTimestamps.length) {
    console.log('── Unparseable timestamps — check the format in the source CSV ──')
    for (const line of badTimestamps.slice(0, 20)) console.log(`  ${line}`)
    if (badTimestamps.length > 20) console.log(`  …and ${badTimestamps.length - 20} more`)
    console.log()
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
      console.log(`  Class ${klass} "${name}" (${count} row${count === 1 ? '' : 's'})${suggestion}`)
    }
    console.log()
  }

  // ── write the report either way (useful even for --dry-run) ──────────────
  const report = {
    generated_at: new Date().toISOString(),
    dry_run: DRY_RUN,
    rows_parsed: rows.length,
    skipped_blank: skippedBlank,
    skipped_bad_timestamp: badTimestamps.length,
    feedback_rows_to_write: feedbackByKey.size,
    unmatched_names: Object.fromEntries(unmatched),
  }
  const reportPath = path.join(path.dirname(FILE_PATH), 'feedback-import-report.json')
  await writeFile(reportPath, JSON.stringify(report, null, 2))
  console.log(`Report written to ${reportPath}`)

  if (DRY_RUN) {
    console.log('\n--dry-run set: nothing was written to Supabase.')
    return
  }

  // ── upsert feedback rows in batches ───────────────────────────────────────
  const feedbackRows = [...feedbackByKey.values()]
  const BATCH = 500
  let written = 0
  for (let i = 0; i < feedbackRows.length; i += BATCH) {
    const batch = feedbackRows.slice(i, i + BATCH)
    const { error } = await supabase
      .from('worksheet_feedback')
      .upsert(batch, { onConflict: 'student_name,class,assignment_name,submitted_at' })
    if (error) throw new Error(`Upsert failed on batch starting at ${i}: ${error.message}`)
    written += batch.length
    console.log(`  upserted ${written}/${feedbackRows.length} feedback rows…`)
  }

  console.log('\nDone.')
}

main().catch((err) => {
  console.error('\nImport failed:', err.message)
  process.exit(1)
})
