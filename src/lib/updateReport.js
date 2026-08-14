import Papa from 'papaparse'

// Parses a Learnyst score export. Columns are fixed by Learnyst's own export
// format (Name, Score, Total Score, Submitted On, Learner Details) — same
// columns the n8n "UPDATE REPORT" workflow read from this file.
export function parseScoreCsv(text) {
  const { data } = Papa.parse(text, { header: true, skipEmptyLines: true })
  return data
    .map((row) => ({
      name: (row.Name || '').trim(),
      score: Number(row.Score),
      totalScore: Number(row['Total Score']),
      submittedOn: (row['Submitted On'] || '').trim(),
      learnerEmail: (row['Learner Details'] || '').trim(),
    }))
    .filter((r) => r.name)
}

function normalizeName(name) {
  return (name || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

// The exam date isn't a form field — it's whatever Learnyst stamped on the
// submissions. Absent students have no CSV row of their own, so they borrow
// the date most of their classmates share (falls back to the first row's
// date if every row happens to differ).
export function computeExamDate(csvRows) {
  const counts = new Map()
  csvRows.forEach((r) => {
    if (!r.submittedOn) return
    counts.set(r.submittedOn, (counts.get(r.submittedOn) || 0) + 1)
  })
  let best = null
  let bestCount = 0
  counts.forEach((count, date) => {
    if (count > bestCount) { best = date; bestCount = count }
  })
  return best ?? csvRows[0]?.submittedOn ?? ''
}

// Learnyst's "Submitted On" is whatever free-form date string their export
// uses, not necessarily YYYY-MM-DD — this turns it into a value an
// `<input type="date">` can actually display, so the exam date field can be
// pre-filled as soon as a CSV loads instead of only appearing (read-only) at
// Preview time. Falls back to '' (leaving the field for the teacher to fill
// in by hand) if the string doesn't parse.
export function parseCsvDateToInputValue(raw) {
  if (!raw) return ''
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return ''
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

// Total Marks is an optional override — if the teacher leaves it blank, fall
// back to whatever Learnyst's own "Total Score" column says (the value most
// rows agree on, same mode-picking approach as computeExamDate, in case a
// stray row has a typo'd total).
export function computeTotalMarksFromCsv(csvRows) {
  const counts = new Map()
  csvRows.forEach((r) => {
    if (!Number.isFinite(r.totalScore) || r.totalScore <= 0) return
    counts.set(r.totalScore, (counts.get(r.totalScore) || 0) + 1)
  })
  let best = null
  let bestCount = 0
  counts.forEach((count, total) => {
    if (count > bestCount) { best = total; bestCount = count }
  })
  if (best !== null) return best
  const fallback = csvRows.find((r) => Number.isFinite(r.totalScore) && r.totalScore > 0)
  return fallback ? fallback.totalScore : null
}

// Matches every roster student against the CSV by name (trimmed,
// case/whitespace-insensitive) — one join key used for scoring, absentee
// rows, and both report CSVs, unlike the original n8n flow which matched by
// name for the DB write but by email for the report CSVs (a student whose
// Learnyst login email differed from their registered email could end up
// scored AND flagged absent under that split). `roster` is expected
// deduped to one entry per student_id (TeacherDashboard's `studentList`).
// `excludeRowIndexes` marks CSV rows (by index into `csvRows`) that must
// never be treated as a name match — used for shared-device rows the
// teacher hasn't manually resolved yet, so a device's own registered name
// can never accidentally auto-match a same-named roster student.
export function matchAndBuildRows({ roster, csvRows, classNum, subject, topicName, totalMarks, examDate, excludeRowIndexes }) {
  const classRoster = roster.filter((s) => Number(s.class) === Number(classNum))
  const excluded = excludeRowIndexes ?? new Set()

  const csvByName = new Map()
  csvRows.forEach((r, i) => {
    if (excluded.has(i)) return
    const key = normalizeName(r.name)
    if (key && !csvByName.has(key)) csvByName.set(key, { ...r, rowIndex: i })
  })

  const matchedRowIndexes = new Set()
  const rows = classRoster.map((student) => {
    const key = normalizeName(student.student_name)
    const csvRow = csvByName.get(key)
    const base = {
      student_id: student.student_id,
      student_name: student.student_name,
      class: Number(classNum),
      subject,
      topic_name: topicName,
      total_marks: Number(totalMarks),
    }
    if (csvRow) {
      matchedRowIndexes.add(csvRow.rowIndex)
      const obtained = csvRow.score
      const originalTotal = csvRow.totalScore
      const scoreObtained = Number.isFinite(obtained) && Number.isFinite(originalTotal) && originalTotal > 0
        ? Math.round((obtained / originalTotal) * Number(totalMarks))
        : 0
      const rowDate = parseCsvDateToInputValue(csvRow.submittedOn) || examDate
      return { ...base, date: rowDate, score_obtained: scoreObtained, is_absent: false }
    }
    return { ...base, date: examDate, score_obtained: 0, is_absent: true }
  })

  const unmatchedCsvNames = csvRows
    .map((r, i) => ({ name: r.name, email: r.learnerEmail, rowIndex: i }))
    .filter((r) => !matchedRowIndexes.has(r.rowIndex))

  return { rows, unmatchedCsvNames }
}

// Reproduces the "Classpro" score-sheet CSV shape from the original
// workflow's Merge SQL: Roll No / Student / Batch / <Subject column>.
export function buildScoreCsv(rows, subject) {
  const sorted = [...rows].sort((a, b) => a.student_name.localeCompare(b.student_name))
  const data = sorted.map((r) => ({
    'Roll No': '',
    Student: r.student_name,
    Batch: '',
    [subject]: r.is_absent ? 'Absent' : r.score_obtained,
  }))
  return Papa.unparse(data)
}

// Reproduces the attendance CSV shape from the original workflow's Merge1
// SQL: ID / Roll No / Name / Attendance / Remark. `sourceIdByStudentId`
// maps student_id -> Learnyst source_id (roster students can have several
// email rows; any one of them carries the same source_id).
export function buildAttendanceCsv(rows, sourceIdByStudentId) {
  const sorted = [...rows].sort((a, b) => a.student_name.localeCompare(b.student_name))
  const data = sorted.map((r) => ({
    ID: sourceIdByStudentId.get(r.student_id) ?? '',
    'Roll No': '',
    Name: r.student_name,
    Attendance: r.is_absent ? 'a' : 'p',
    Remark: '',
  }))
  return Papa.unparse(data)
}
