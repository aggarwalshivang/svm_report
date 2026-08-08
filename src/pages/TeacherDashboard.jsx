import { useEffect, useState, useMemo, useRef, Fragment } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ComposedChart, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer, LineChart, Line, Cell, Legend,
} from 'recharts'
import { supabase } from '../lib/supabase'
import { ThemeToggle } from '../lib/theme.jsx'
import {
  computeSubmissionPerformance, aggregateChapterStats, aggregateSubjectStats,
  topRecurringIssues, classifyChapters, buildSuggestion,
} from '../lib/worksheetAnalysis'

const GOLD = 'var(--gold)'
const NAV  = 'var(--nav)'
const DARK = 'var(--page-bg)'

const N8N_WEBHOOK_EXAMPLE = `POST https://cexbpkbadthoqbruyjdg.supabase.co/functions/v1/assignment-webhook
Content-Type: application/json
x-api-key: <ASSIGNMENT_WEBHOOK_KEY>

{
  "class": "9",
  "subject": "Maths",
  "assignment_name": "Chapter 4 worksheet",
  "deadline": "2026-08-05T18:00:00+05:30",
  "link": "https://drive.google.com/file/d/.../view",
  "other": "",
  "portion": "Chapter 4 | 10 Qs | Class 9",
  "folder": "<Google Drive folder id for submissions>"
}`

// Placeholders available to the teacher when customizing the top-scorer message format.
const MESSAGE_FORMAT_PLACEHOLDERS = [
  { key: 'testNo', label: 'Test number' },
  { key: 'date', label: 'Test date' },
  { key: 'subject', label: 'Subject' },
  { key: 'topic', label: 'Chapter / topic' },
  { key: 'class', label: 'Class' },
  { key: 'totalMarks', label: 'Total marks' },
  { key: 'thresholdLabel', label: 'Threshold shown (e.g. ≥70%)' },
  { key: 'list', label: 'Ranked list of top scorers' },
]
const DEFAULT_MESSAGE_FORMAT = `✅ *Practice Test #{testNo} Scores – {date}*

The scores have been sent individually to parents via personal *WhatsApp*.

🏆 *Only the Top Scorers are shared in the group.*

📚 *{subject} - {topic}*
📊 *Total Marks:* {totalMarks}

*Top Performers ({thresholdLabel}):*

{list}

📞 *For any queries, please contact 999-266-1556.*

🙏 Thank you for your support!

*Saraswati Vidyamandir*`
const MESSAGE_FORMAT_STORAGE_KEY = 'svm_message_format'
// worksheet_feedback rows store text prefixed with "[Assignment Name, Class N,
// Subject] " so a row reads standalone without a join — redundant once shown
// under the assignment's own row here, so strip it back off for display.
function stripFeedbackContext(text) {
  return (text || '').replace(/^\[[^\]]*\]\s*/, '')
}

// worksheet_feedback is mostly a one-off import from the school's old Google
// Form process, which names worksheets in its own free-text, evolving way
// (e.g. "Algebraic Identities till Example 16") — never the same string as
// this app's clean assignment titles, so there's no exact key to join on.
// Same fuzzy matching as StudentDashboard.jsx: score every (assignment,
// feedback) pair by title word-overlap + subject compatibility.
const FEEDBACK_MATCH_STOPWORDS = new Set([
  'and', 'of', 'in', 'the', 'to', 'a', 'an', 'for', 'on', 'with',
  'till', 'ex', 'example', 'examples', 'q', 'class', 'chapter',
  'full', 'exercise', 'exercises', 'end', 'sum', 'till',
])
function sigWords(s) {
  return new Set(
    (s || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !FEEDBACK_MATCH_STOPWORDS.has(w) && Number.isNaN(Number(w)))
  )
}
function jaccard(a, b) {
  if (!a.size || !b.size) return 0
  let inter = 0
  for (const w of a) if (b.has(w)) inter++
  return inter / (a.size + b.size - inter)
}
function subjectsCompatible(assignmentSubject, feedbackSubject) {
  const norm = (s) => (s || '').toLowerCase().replace('maths', 'math')
  const as = norm(assignmentSubject)
  const fs = norm(feedbackSubject)
  if (!as || !fs) return false
  return fs.includes(as) || as.includes(fs)
}
const FEEDBACK_MATCH_THRESHOLD = 0.2
// Creates the student's login (unknown random password) and emails them
// step-by-step instructions for setting their own password via "Forgot
// password?", via a Supabase Edge Function — it needs the service-role key,
// which must never live in browser code.
async function provisionStudentAccount(email, studentId, studentName) {
  const { data, error } = await supabase.functions.invoke('create-student-account', {
    body: { email, student_id: studentId, student_name: studentName },
  })
  if (error) return { email, ok: false, message: error.message }
  if (data?.ok === false) return { email, ok: false, message: data.error }
  return { email, ok: true }
}

// Excludes tests dated before a student's report_start_date (set when they're
// added mid-year) so pre-enrollment tests never count toward their stats.
function countsForStudent(row, student) {
  return !student?.report_start_date || row.date >= student.report_start_date
}

// Assignment dates are stored in UTC (timestamptz) — always display them in
// Indian time regardless of the viewer's device timezone.
function formatIST(isoString) {
  if (!isoString) return '—'
  return new Date(isoString).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

export default function TeacherDashboard() {
  const navigate = useNavigate()
  const session = JSON.parse(localStorage.getItem('svm_session') || 'null')

  const [students, setStudents] = useState([])
  const [allScores, setAllScores] = useState([])
  const [loading, setLoading] = useState(true)
  const [classFilter, setClassFilter] = useState('All')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(null)
  const [view, setView] = useState('students') // 'students' | 'tests'
  const [sending, setSending] = useState(null)
  const [sendResult, setSendResult] = useState(null)
  const [previewTest, setPreviewTest] = useState(null)
  const [previewMessage, setPreviewMessage] = useState('')
  const [messageFormat, setMessageFormat] = useState(() => {
    try { return localStorage.getItem(MESSAGE_FORMAT_STORAGE_KEY) || DEFAULT_MESSAGE_FORMAT } catch { return DEFAULT_MESSAGE_FORMAT }
  })
  const [formatModalOpen, setFormatModalOpen] = useState(false)
  const [editingTest, setEditingTest] = useState(null)
  const [savingTestEdit, setSavingTestEdit] = useState(false)
  const [deletingTest, setDeletingTest] = useState(null)
  const [deletingTestKey, setDeletingTestKey] = useState(null)
  const [sentReports, setSentReports] = useState(() => {
    try { return JSON.parse(localStorage.getItem('svm_sent_reports') || '{}') } catch { return {} }
  })

// Student table sort state
  const [studentSort, setStudentSort] = useState({ col: 'avgPct', dir: 'desc' })

  function toggleStudentSort(col) {
    setStudentSort(prev => prev.col === col ? { col, dir: prev.dir === 'desc' ? 'asc' : 'desc' } : { col, dir: 'desc' })
  }

  // Tests table sort state
  const [testSort, setTestSort] = useState({ col: 'date', dir: 'desc' })

  function toggleTestSort(col) {
    setTestSort(prev => prev.col === col ? { col, dir: prev.dir === 'desc' ? 'asc' : 'desc' } : { col, dir: 'desc' })
  }

  // Top-scorer report filters (used by the "Top" column + WhatsApp report)
  const [topPctFilter, setTopPctFilter] = useState('70') // '0'..'100' in steps of 10 ('0' = no minimum)
  const [topNFilter, setTopNFilter] = useState('any')    // '10' | '20' | '30' | '40' | 'any'

  // Chapter analysis sort + filter state
  const [chapterSort, setChapterSort] = useState({ col: 'avg', dir: 'desc' })
  const [chapterSubject, setChapterSubject] = useState('All')

  // Worksheet performance subject filter — kept independent from
  // chapterSubject above so switching between the Tests "Analysis" tab and
  // this "Worksheet Performance" tab doesn't cross-pollinate.
  const [wsChapterSubject, setWsChapterSubject] = useState('All')

  // Manage tab state
  const [manageMode, setManageMode] = useState('list') // 'list' | 'add'
  const [newStudent, setNewStudent] = useState({ name: '', class: '9', sourceId: '', phone: '', emails: [''] })
  const [savingStudent, setSavingStudent] = useState(false)
  const [deletingStudentId, setDeletingStudentId] = useState(null)
  const [confirmDeleteStudent, setConfirmDeleteStudent] = useState(null)
  const [expandedStudent, setExpandedStudent] = useState(null)
  const [pendingEmail, setPendingEmail] = useState('')
  const [savingEmail, setSavingEmail] = useState(false)
  const [deletingEmailId, setDeletingEmailId] = useState(null)
  const [editingEmailId, setEditingEmailId] = useState(null)
  const [editingEmailValue, setEditingEmailValue] = useState('')
  const [savingEditEmail, setSavingEditEmail] = useState(false)
  const [editingSourceIdRow, setEditingSourceIdRow] = useState(null)
  const [editingSourceIdValue, setEditingSourceIdValue] = useState('')
  const [savingSourceId, setSavingSourceId] = useState(false)
  const [editingPhoneStudentId, setEditingPhoneStudentId] = useState(null)
  const [editingPhoneValue, setEditingPhoneValue] = useState('')
  const [savingPhone, setSavingPhone] = useState(false)
  const [creatingLoginId, setCreatingLoginId] = useState(null)

  // Assignments tab state — worksheetReport is the public.worksheet_report
  // table (one row per worksheet, already carrying submission/feedback
  // counts computed server-side by triggers); assignmentSubmissions/
  // worksheetFeedback are still fetched for the per-worksheet expanded
  // detail view below, which needs per-student names and feedback text the
  // aggregate table doesn't store.
  const [worksheetReport, setWorksheetReport] = useState([])
  const [assignmentSubmissions, setAssignmentSubmissions] = useState([])
  const [worksheetFeedback, setWorksheetFeedback] = useState([])
  const [deletingAssignmentId, setDeletingAssignmentId] = useState(null)
  const [confirmDeleteAssignment, setConfirmDeleteAssignment] = useState(null)
  const [confirmReopenAssignment, setConfirmReopenAssignment] = useState(null)
  const [assignmentClass, setAssignmentClass] = useState('9')
  const [assignmentSort, setAssignmentSort] = useState('deadline-desc')
  const [expandedAnalysisId, setExpandedAnalysisId] = useState(null)
  const [markingAllSubmittedId, setMarkingAllSubmittedId] = useState(null)
  const [n8nDocsOpen, setN8nDocsOpen] = useState(false)
  const [n8nCopied, setN8nCopied] = useState(false)

  useEffect(() => {
    // Supabase caps every select at 1000 rows by default — page through
    // `.range()` until a page comes back short. assignment_submissions and
    // worksheet_feedback both blow past that (the historical CSV imports
    // alone are 2,500+ rows each), so an unpaginated `.select('*')` silently
    // truncates them, making the client-side "who submitted"/"who's graded"
    // matching miss real rows even though the server-side worksheet_report
    // view (a plain SQL count, not subject to the API row cap) has them.
    async function fetchAll(table) {
      const PAGE = 1000
      let allRows = []
      let from = 0
      while (true) {
        const { data, error } = await supabase.from(table).select('*').range(from, from + PAGE - 1)
        if (error || !data || data.length === 0) break
        allRows = allRows.concat(data)
        if (data.length < PAGE) break
        from += PAGE
      }
      return allRows
    }

    async function load() {
      const [{ data: studs }, { data: wr }, subs, wfb, allRows] = await Promise.all([
        supabase.from('student_emails').select('*').order('class').order('student_name'),
        supabase.from('worksheet_report').select('*').order('deadline'),
        fetchAll('assignment_submissions'),
        fetchAll('worksheet_feedback'),
        fetchAll('student_scores'),
      ])
      setStudents(studs || [])
      setWorksheetReport(wr || [])
      setAssignmentSubmissions(subs)
      setWorksheetFeedback(wfb)
      setAllScores(allRows)
      setLoading(false)
    }
    load()
  }, [])

  async function logout() {
    await supabase.auth.signOut()
    localStorage.removeItem('svm_session')
    navigate('/')
  }

  const studentSummary = useMemo(() => {
    const seenIds = new Set()
    const uniqueStudents = students.filter((s) => { if (seenIds.has(s.student_id)) return false; seenIds.add(s.student_id); return true })
    const summaries = uniqueStudents.map((s) => {
      const rows = allScores.filter((r) => r.student_id === s.student_id && countsForStudent(r, s))
      const appeared = rows.filter((r) => !r.is_absent)
      const absentCount = rows.filter((r) => r.is_absent).length
      const avgPct = appeared.length > 0
        ? (appeared.reduce((sum, r) => sum + (r.score_obtained / r.total_marks) * 100, 0) / appeared.length).toFixed(1)
        : null
      const sciRows  = appeared.filter((r) => r.subject === 'Science')
      const mathRows = appeared.filter((r) => r.subject === 'Maths')
      const sciAvg  = sciRows.length  ? (sciRows.reduce((a, r)  => a + (r.score_obtained / r.total_marks) * 100, 0) / sciRows.length).toFixed(1)  : null
      const mathAvg = mathRows.length ? (mathRows.reduce((a, r) => a + (r.score_obtained / r.total_marks) * 100, 0) / mathRows.length).toFixed(1) : null
      const totalScored = appeared.reduce((sum, r) => sum + r.score_obtained, 0)
      const totalMarks  = appeared.reduce((sum, r) => sum + r.total_marks, 0)
      const totalLost   = totalMarks - totalScored
      const positivePct = totalMarks > 0 ? +((totalScored / totalMarks) * 100).toFixed(1) : null
      const negativePct = totalMarks > 0 ? +((totalLost   / totalMarks) * 100).toFixed(1) : null
      const sorted = [...appeared].sort((a, b) => a.date.localeCompare(b.date))
      const avg3 = (arr) => arr.reduce((s, r) => s + (r.score_obtained / r.total_marks) * 100, 0) / arr.length
      let trend = null
      if (sorted.length >= 6) {
        const delta = avg3(sorted.slice(-3)) - avg3(sorted.slice(0, 3))
        trend = delta > 5 ? 'up' : delta < -5 ? 'down' : 'stable'
      }
      return { ...s, totalTests: rows.length, appeared: appeared.length, absentCount, avgPct, sciAvg, mathAvg, totalScored, totalMarks, totalLost, positivePct, negativePct, trend }
    })

    // Compute rank within each class
    ;[9, 10].forEach((cls) => {
      const inClass = summaries.filter((s) => s.class === cls && s.avgPct !== null)
        .sort((a, b) => Number(b.avgPct) - Number(a.avgPct))
      const classSize = summaries.filter((s) => s.class === cls).length
      inClass.forEach((s, i) => { s.rank = i + 1; s.classSize = classSize })
      summaries.filter((s) => s.class === cls && s.avgPct === null).forEach((s) => { s.rank = null; s.classSize = classSize })
    })

    return summaries
  }, [students, allScores])

  const filtered = studentSummary
    .filter((s) => {
      if (classFilter !== 'All' && String(s.class) !== classFilter) return false
      if (search && !s.student_name.toLowerCase().includes(search.toLowerCase())) return false
      return true
    })
    .sort((a, b) => {
      const { col, dir } = studentSort
      const mul = dir === 'asc' ? 1 : -1
      const av = a[col], bv = b[col]
      if (av === null && bv === null) return 0
      if (av === null) return 1
      if (bv === null) return -1
      if (col === 'student_name') return mul * String(av).localeCompare(String(bv))
      return mul * (Number(av) - Number(bv))
    })

  const scope = classFilter === 'All' ? studentSummary : studentSummary.filter((s) => String(s.class) === classFilter)
  const withData = scope.filter((s) => s.avgPct !== null)
  const classAvg = withData.length
    ? (withData.reduce((a, s) => a + Number(s.avgPct), 0) / withData.length).toFixed(1)
    : 'N/A'

  const chapterStats = useMemo(() => {
    const scopeById = new Map(scope.map((s) => [s.student_id, s]))
    const map = {}
    allScores.forEach((r) => {
      const student = scopeById.get(r.student_id)
      if (!student || r.is_absent || !countsForStudent(r, student)) return
      const key = `${r.subject}||${r.topic_name}`
      if (!map[key]) map[key] = { subject: r.subject, topic: r.topic_name, total: 0, count: 0, tests: new Set(), best: 0, worst: 100 }
      const pct = (r.score_obtained / r.total_marks) * 100
      map[key].total += pct
      map[key].count += 1
      map[key].tests.add(`${r.date}|${r.topic_name}|${r.total_marks}`)
      map[key].best  = Math.max(map[key].best, pct)
      map[key].worst = Math.min(map[key].worst, pct)
    })
    return Object.values(map).map((t) => ({
      ...t,
      avg:   +( t.total / t.count).toFixed(1),
      best:  +t.best.toFixed(1),
      worst: +t.worst.toFixed(1),
      testCount: t.tests.size,
    })).sort((a, b) => b.avg - a.avg)
  }, [allScores, scope])

  const uniqueTests = useMemo(() => {
    const studentMap = Object.fromEntries(students.map((s) => [s.student_id, s]))
    const map = {}
    allScores.forEach((score) => {
      const student = studentMap[score.student_id]
      if (!student || !countsForStudent(score, student)) return
      const key = `${score.date}|${score.subject}|${score.topic_name}|${score.total_marks}|${student.class}`
      if (!map[key]) map[key] = { key, date: score.date, subject: score.subject, topic: score.topic_name, total_marks: score.total_marks, class: student.class, scores: [] }
      map[key].scores.push({ ...score, student_name: student.student_name })
    })
    return Object.values(map)
      .sort((a, b) => a.date.localeCompare(b.date) || a.subject.localeCompare(b.subject))
      .map((t, i) => ({ ...t, testNo: i + 1 }))
  }, [allScores, students])

  const filteredTests = uniqueTests.filter((t) => classFilter === 'All' || String(t.class) === classFilter)

  const filteredAssignments = worksheetReport
    .filter((a) => String(a.class) === assignmentClass)
    .filter((a) => !search || a.title.toLowerCase().includes(search.toLowerCase()) || a.subject.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      if (assignmentSort === 'deadline-asc')  return new Date(a.deadline) - new Date(b.deadline)
      if (assignmentSort === 'deadline-desc') return new Date(b.deadline) - new Date(a.deadline)
      if (assignmentSort === 'subject')        return a.subject.localeCompare(b.subject)
      if (assignmentSort === 'title')          return a.title.localeCompare(b.title)
      return 0
    })

  // Submission-rate analysis shown at the top of the Assignments tab — covers
  // every assignment/class, independent of the class toggle used by the table below.
  const assignmentAnalysis = useMemo(() => {
    const rosterFor = (cls) => studentSummary.filter((s) => String(s.class) === cls)

    // Grouped once so each assignment only scores its own roster's feedback
    // rows, not the whole table. The CSV import left student_id null for any
    // row whose name it couldn't roster-match (scripts/import-worksheet-feedback.mjs)
    // — those rows still have a correct `class`, just no id, so they're also
    // indexed by (class, normalized name) and re-attached to the matching
    // roster student below instead of being silently dropped.
    const normName = (name) => (name || '').toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim()
    const feedbackByStudentId = new Map()
    const feedbackByClassName = new Map()
    worksheetFeedback.forEach((f) => {
      if (f.student_id != null) {
        if (!feedbackByStudentId.has(f.student_id)) feedbackByStudentId.set(f.student_id, [])
        feedbackByStudentId.get(f.student_id).push(f)
      } else {
        const key = `${f.class}|${normName(f.student_name)}`
        if (!feedbackByClassName.has(key)) feedbackByClassName.set(key, [])
        feedbackByClassName.get(key).push(f)
      }
    })

    const perAssignment = worksheetReport
      .map((a) => {
        const roster = rosterFor(String(a.class))
        const submittedIds = new Set(
          assignmentSubmissions.filter((s) => s.assignment_id === a.id).map((s) => s.student_id)
        )
        const aWords = sigWords(a.title)
        const deadlineMs = new Date(a.deadline).getTime()
        const createdMs = new Date(a.created_at).getTime()

        const perStudent = roster.map((s) => {
          const byId = feedbackByStudentId.get(s.student_id) || []
          const byName = feedbackByClassName.get(`${a.class}|${normName(s.student_name)}`) || []
          const candidates = byId.length && byName.length ? [...byId, ...byName] : (byId.length ? byId : byName)
          // A row already tagged with this exact assignment (live in-app
          // submissions always set assignment_id) is definitive proof — skip
          // fuzzy matching. Rows tagged for a *different* assignment must
          // never be fuzzy-matched here either; only untagged legacy
          // CSV-import rows (assignment_id null) go through title matching,
          // and only if they postdate this assignment's own creation — an
          // old Google-Form-import row can't be a submission to a worksheet
          // that didn't exist yet, no matter how similar the title reads.
          let best = candidates.find((f) => f.assignment_id === a.id) || null
          let bestScore = best ? 1 : 0, bestDateDiff = 0
          if (!best) candidates.forEach((f) => {
            if (f.assignment_id != null) return
            if (new Date(f.submitted_at).getTime() < createdMs) return
            if (!subjectsCompatible(a.subject, f.subject)) return
            const score = jaccard(aWords, sigWords(f.assignment_name))
            if (score < FEEDBACK_MATCH_THRESHOLD) return
            const dateDiff = Math.abs(new Date(f.submitted_at).getTime() - deadlineMs)
            if (score > bestScore || (score === bestScore && dateDiff < bestDateDiff)) {
              best = f; bestScore = score; bestDateDiff = dateDiff
            }
          })
          // A matched feedback row is itself proof of submission, same as
          // assignmentStatus() on the student dashboard — some real
          // submissions only exist as an imported feedback row, never an
          // assignment_submissions row (that table only fills in from the
          // in-app upload flow).
          const submitted = submittedIds.has(s.student_id) || !!best
          return { student: s, feedback: best, submitted }
        })

        const missing = perStudent.filter((x) => !x.submitted).map((x) => x.student)
        const submittedWithFeedback = perStudent.filter((x) => x.submitted)
        const total = roster.length
        const submittedCount = submittedWithFeedback.length
        const rate = total > 0 ? Math.round((submittedCount / total) * 100) : 0
        const gradedCount = submittedWithFeedback.filter((x) => x.feedback).length

        return { assignment: a, submittedCount, total, rate, missing, gradedCount, submittedWithFeedback }
      })
      .sort((a, b) => new Date(b.assignment.deadline) - new Date(a.assignment.deadline))

    // Straight from worksheet_report's own submitted_pct (server-computed
    // from real assignment_submissions rows), not the fuzzy-match rate above
    // — this is the number the "Worksheet Analysis" cards show.
    const perClass = ['9', '10'].map((cls) => {
      const clsRows = worksheetReport.filter((a) => String(a.class) === cls)
      const avgRate = clsRows.length
        ? Math.round(clsRows.reduce((sum, a) => sum + Number(a.submitted_pct), 0) / clsRows.length)
        : 0
      return { class: cls, avgRate, assignmentCount: clsRows.length, rosterSize: rosterFor(cls).length }
    })

    return { perAssignment, perClass }
  }, [worksheetReport, assignmentSubmissions, worksheetFeedback, studentSummary])

  const analysisByAssignmentId = useMemo(
    () => Object.fromEntries(assignmentAnalysis.perAssignment.map((p) => [p.assignment.id, p])),
    [assignmentAnalysis]
  )

  // Worksheet performance analysis — derived by text-mining assignment_feedback
  // (worksheets carry no marks/chapter tag of their own). Built on top of the
  // {student, feedback} pairs assignmentAnalysis already matched above, so
  // this doesn't redo the assignment<->feedback fuzzy matching.
  const worksheetSubmissionPerf = useMemo(() => {
    const rows = []
    assignmentAnalysis.perAssignment.forEach(({ assignment, submittedWithFeedback }) => {
      submittedWithFeedback.forEach(({ student, feedback }) => {
        const row = computeSubmissionPerformance(assignment, feedback, student)
        if (row) rows.push({ ...row, class: assignment.class })
      })
    })
    return rows
  }, [assignmentAnalysis])

  const worksheetPerfInScope = useMemo(
    () => (classFilter === 'All' ? worksheetSubmissionPerf : worksheetSubmissionPerf.filter((r) => String(r.class) === classFilter)),
    [worksheetSubmissionPerf, classFilter]
  )

  const worksheetChapterStats = useMemo(() => aggregateChapterStats(worksheetPerfInScope), [worksheetPerfInScope])
  const worksheetSubjectStats = useMemo(() => aggregateSubjectStats(worksheetPerfInScope), [worksheetPerfInScope])
  const worksheetRecurringIssues = useMemo(() => topRecurringIssues(worksheetPerfInScope), [worksheetPerfInScope])

  const topPctThreshold = Number(topPctFilter) / 100

  const sortedTests = [...filteredTests]
    .map((t) => {
      const appeared = t.scores.filter((s) => !s.is_absent)
      const qualifiers = appeared
        .filter((s) => s.score_obtained / t.total_marks >= topPctThreshold)
        .sort((a, b) => b.score_obtained - a.score_obtained)
      const capped = topNFilter === 'any' ? qualifiers : qualifiers.slice(0, Number(topNFilter))
      return { ...t, appearedCount: appeared.length, topCount70: capped.length }
    })
    .sort((a, b) => {
      const { col, dir } = testSort
      const mul = dir === 'asc' ? 1 : -1
      const av = a[col], bv = b[col]
      if (av === null && bv === null) return 0
      if (av === null) return 1
      if (bv === null) return -1
      if (typeof av === 'string') return mul * av.localeCompare(bv)
      return mul * (Number(av) - Number(bv))
    })

  const studentList = useMemo(() => {
    const map = {}
    students.forEach((row) => {
      if (!map[row.student_id]) map[row.student_id] = { student_id: row.student_id, student_name: row.student_name, class: row.class, phone: row.phone ?? null, emails: [] }
      if (row.email) map[row.student_id].emails.push({ id: row.id, email: row.email, source_id: row.source_id ?? null, login_created: !!row.login_created })
    })
    return Object.values(map).sort((a, b) => Number(a.class) - Number(b.class) || a.student_name.localeCompare(b.student_name))
  }, [students])

  function applyMessageFormat(template, values) {
    return template.replace(/\{(\w+)\}/g, (m, key) => (key in values ? String(values[key]) : m))
  }

  function generateMessage(test, format = messageFormat) {
    const d = new Date(test.date + 'T00:00:00')
    const dateStr = d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })
    let topScorers = test.scores
      .filter((s) => !s.is_absent && s.score_obtained / test.total_marks >= topPctThreshold)
      .sort((a, b) => b.score_obtained - a.score_obtained || a.student_name.localeCompare(b.student_name))
    if (topNFilter !== 'any') topScorers = topScorers.slice(0, Number(topNFilter))
    let rank = 1
    const ranked = topScorers.map((s, i) => {
      if (i > 0 && s.score_obtained < topScorers[i - 1].score_obtained) rank = i + 1
      return { ...s, rank }
    })
    const thresholdLabel = topPctFilter === '0' ? 'All' : `≥${topPctFilter}%`
    const list = ranked.length
      ? ranked.map((s) => `${s.rank}. ${s.student_name} - ${s.score_obtained}/${test.total_marks}`).join('\n')
      : `_(No students scored ${thresholdLabel})_`
    return applyMessageFormat(format, {
      testNo: test.testNo,
      date: dateStr,
      subject: test.subject,
      topic: test.topic,
      class: test.class,
      totalMarks: test.total_marks,
      thresholdLabel,
      list,
    })
  }

  function openPreview(test) {
    setPreviewMessage(generateMessage(test))
    setPreviewTest(test)
  }

  function saveMessageFormat(next) {
    setMessageFormat(next)
    try { localStorage.setItem(MESSAGE_FORMAT_STORAGE_KEY, next) } catch { /* ignore */ }
    setFormatModalOpen(false)
  }

  async function sendReport(test, message) {
    setSending(test.key)
    setSendResult(null)
    try {
      const res = await fetch('https://n8n.saraswatividyamandir.com/webhook/svm-top-scorer-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, class: String(test.class) }),
      })
      if (res.ok) {
        const updated = { ...sentReports, [test.key]: new Date().toISOString() }
        setSentReports(updated)
        localStorage.setItem('svm_sent_reports', JSON.stringify(updated))
      }
      setSendResult({ key: test.key, success: res.ok })
    } catch {
      setSendResult({ key: test.key, success: false })
    }
    setSending(null)
  }

  async function saveTestEdit(test, newTotalMarks, minPercent) {
    setSavingTestEdit(true)
    const oldTotalMarks = test.total_marks

    // Rescale each student's obtained score proportionally so their percentage stays the same
    // (e.g. 32/40 = 80% becomes 24/30 = 80% when the total is changed to 30).
    const rescaled = test.scores.map((s) => ({
      id: s.id,
      score_obtained: s.is_absent
        ? s.score_obtained
        : Math.max(0, Math.min(newTotalMarks, Math.round((s.score_obtained / oldTotalMarks) * newTotalMarks))),
    }))

    // Floor: anyone below this % of the new total marks gets bumped up to it.
    const floor = minPercent > 0 ? Math.round((minPercent / 100) * newTotalMarks) : 0
    const isAbsent = new Map(test.scores.map((s) => [s.id, s.is_absent]))
    const finalScores = rescaled.map((s) => ({
      id: s.id,
      score_obtained: (!isAbsent.get(s.id) && s.score_obtained < floor) ? floor : s.score_obtained,
    }))

    const results = await Promise.all(finalScores.map((s) =>
      supabase
        .from('student_scores')
        .update({ total_marks: newTotalMarks, score_obtained: s.score_obtained })
        .eq('id', s.id)
    ))
    const failed = results.find((r) => r.error)
    if (failed) {
      alert(`Failed to update scores: ${failed.error.message}`)
      setSavingTestEdit(false)
      return
    }

    const scoreMap = new Map(finalScores.map((s) => [s.id, s.score_obtained]))
    setAllScores((prev) => prev.map((r) => (
      scoreMap.has(r.id)
        ? { ...r, total_marks: newTotalMarks, score_obtained: scoreMap.get(r.id) }
        : r
    )))
    setSavingTestEdit(false)
    setEditingTest(null)
  }

  async function deleteTest(test) {
    setDeletingTest(null)
    setDeletingTestKey(test.key)
    const ids = test.scores.map((s) => s.id)
    const { data, error } = await supabase.from('student_scores').delete().in('id', ids).select('id')
    if (error) {
      alert(`Failed to delete test: ${error.message}`)
    } else if (!data || data.length === 0) {
      alert('Delete was blocked by Supabase (likely a Row Level Security policy) — the test was not removed.')
    } else {
      const idSet = new Set(ids)
      setAllScores((prev) => prev.filter((r) => !idSet.has(r.id)))
    }
    setDeletingTestKey(null)
  }

  async function notifyStudentWorksheetWebhook(action, { name, phone, studentClass }) {
    try {
      await fetch('https://n8n.saraswatividyamandir.com/webhook/add-delete-svm-worksheet-students', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          'Student Name': name,
          'Phone Number': phone,
          'Class': String(studentClass),
        }),
      })
    } catch {
      // best-effort notification; a failure here shouldn't block add/delete
    }
  }

  async function addStudent() {
    const validEmails = newStudent.emails.filter((e) => e.trim())
    if (!newStudent.name.trim() || !newStudent.class || !newStudent.sourceId.trim() || !validEmails.length) return
    const sourceId = Number(newStudent.sourceId.trim())
    if (!Number.isFinite(sourceId)) { alert('ID must be a number.'); return }
    setSavingStudent(true)
    const maxId = students.length ? Math.max(...students.map((s) => Number(s.student_id))) : 0
    const newId = maxId + 1
    const reportStartDate = new Date().toISOString().slice(0, 10)
    const phone = newStudent.phone.trim() || null
    const rows = validEmails.map((email) => ({
      student_id: newId,
      student_name: newStudent.name.trim(),
      class: Number(newStudent.class),
      email: email.trim().toLowerCase(),
      source_id: sourceId,
      phone,
      report_start_date: reportStartDate,
    }))
    const { data, error } = await supabase.from('student_emails').insert(rows).select()
    if (error) {
      alert(`Failed to add student: ${error.message}`)
    } else if (!data || data.length === 0) {
      alert("Add was blocked by Supabase (likely a Row Level Security policy) — the student was not added.")
    } else {
      setStudents((prev) => [...prev, ...data])
      notifyStudentWorksheetWebhook('add', {
        name: newStudent.name.trim(),
        phone,
        studentClass: newStudent.class,
      })
      setNewStudent({ name: '', class: '9', sourceId: '', phone: '', emails: [''] })
      setManageMode('list')
    }
    setSavingStudent(false)
  }

  async function deleteStudent(student) {
    const studentId = student.student_id
    setConfirmDeleteStudent(null)
    setDeletingStudentId(studentId)
    // Delete child rows (student_scores) before the parent (student_emails) — deleting
    // them concurrently can race a foreign-key constraint and silently fail the parent delete.
    // .select() is required on every delete: Supabase/RLS returns no error when a policy
    // silently blocks the delete (0 rows affected) — without .select() that looks identical
    // to a successful delete, so the row stays in the DB while the UI thinks it's gone.
    const { error: scoresErr } = await supabase
      .from('student_scores').delete().eq('student_id', studentId).select('id')
    if (scoresErr) {
      alert(`Failed to remove student's scores: ${scoresErr.message}`)
      setDeletingStudentId(null)
      return
    }

    const { data: deletedEmails, error: emailsErr } = await supabase
      .from('student_emails').delete().eq('student_id', studentId).select('id')
    if (emailsErr) {
      alert(`Failed to remove student: ${emailsErr.message}`)
      setDeletingStudentId(null)
      return
    }
    if (!deletedEmails || deletedEmails.length === 0) {
      alert(
        "Delete was blocked by Supabase (likely a Row Level Security policy) — no rows were actually removed.\n\n" +
        "Ask your Supabase admin to add DELETE policies for the 'authenticated' role on the " +
        "student_emails and student_scores tables, then try again."
      )
      setDeletingStudentId(null)
      return
    }

    setStudents((prev) => prev.filter((s) => s.student_id !== studentId))
    setAllScores((prev) => prev.filter((s) => s.student_id !== studentId))
    if (expandedStudent === studentId) setExpandedStudent(null)
    notifyStudentWorksheetWebhook('remove', {
      name: student.student_name,
      phone: student.phone,
      studentClass: student.class,
    })
    setDeletingStudentId(null)
  }

  async function toggleSubmissionsClosed(assignment) {
    const submissions_closed = !assignment.submissions_closed
    setWorksheetReport((prev) => prev.map((a) => (a.id === assignment.id ? { ...a, submissions_closed } : a)))
    const { data, error } = await supabase.from('assignments').update({ submissions_closed }).eq('id', assignment.id).select('id')
    if (error || !data || data.length === 0) {
      setWorksheetReport((prev) => prev.map((a) => (a.id === assignment.id ? { ...a, submissions_closed: !submissions_closed } : a)))
      alert(`Failed to update worksheet: ${error?.message || 'blocked by Supabase (RLS)'}`)
    }
  }

  async function markAllSubmitted(p) {
    const missing = p.missing
    if (missing.length === 0) return
    if (!confirm(`Mark all ${missing.length} missing student(s) as submitted for "${p.assignment.title}"? This creates a submission record for each of them (${p.total}/${p.total}) and will show up on their dashboards too.`)) return

    setMarkingAllSubmittedId(p.assignment.id)
    const submitted_at = new Date().toISOString()
    const rows = missing.map((s) => ({
      assignment_id: p.assignment.id,
      student_id: s.student_id,
      student_name: s.student_name,
      submitted_at,
    }))
    const { data, error } = await supabase
      .from('assignment_submissions')
      .upsert(rows, { onConflict: 'assignment_id,student_id' })
      .select('id, assignment_id, student_id, student_name, submitted_at')

    if (error || !data || data.length === 0) {
      alert(`Failed to mark submissions: ${error?.message || 'blocked by Supabase (RLS)'}`)
    } else {
      setAssignmentSubmissions((prev) => [...prev, ...data])
      // The DB trigger already recomputed worksheet_report's row server-side;
      // patch the local copy the same way so the header stats update
      // immediately instead of waiting for a reload.
      setWorksheetReport((prev) => prev.map((a) => (a.id === p.assignment.id
        ? { ...a, submitted_count: a.total_students, missing_count: 0, submitted_pct: a.total_students ? 100 : 0 }
        : a
      )))
    }
    setMarkingAllSubmittedId(null)
  }

  async function deleteAssignment(id) {
    setConfirmDeleteAssignment(null)
    setDeletingAssignmentId(id)
    const { data, error } = await supabase.from('assignments').delete().eq('id', id).select('id')
    if (error) {
      alert(`Failed to delete worksheet: ${error.message}`)
    } else if (!data || data.length === 0) {
      alert("Delete was blocked by Supabase (likely a Row Level Security policy) — the worksheet was not removed.")
    } else {
      setWorksheetReport((prev) => prev.filter((a) => a.id !== id))
    }
    setDeletingAssignmentId(null)
  }

  async function addEmailToStudent(student) {
    const email = pendingEmail.trim().toLowerCase()
    if (!email) return
    setSavingEmail(true)
    const { data, error } = await supabase.from('student_emails').insert([{
      student_id: student.student_id,
      student_name: student.student_name,
      class: student.class,
      email,
      phone: student.phone ?? null,
    }]).select()
    if (error) {
      alert(`Failed to add email: ${error.message}`)
    } else if (!data || data.length === 0) {
      alert("Add was blocked by Supabase (likely a Row Level Security policy) — the email was not added.")
    } else {
      setStudents((prev) => [...prev, ...data])
      setPendingEmail('')
    }
    setSavingEmail(false)
  }

  async function createStudentLogin(student) {
    const pendingEmails = student.emails.filter((e) => !e.login_created)
    if (!pendingEmails.length) return
    setCreatingLoginId(student.student_id)
    const results = await Promise.all(
      pendingEmails.map((e) => provisionStudentAccount(e.email, student.student_id, student.student_name))
    )
    const succeededIds = pendingEmails.filter((_, i) => results[i].ok).map((e) => e.id)
    if (succeededIds.length) {
      await supabase.from('student_emails').update({ login_created: true }).in('id', succeededIds)
      setStudents((prev) => prev.map((r) => (succeededIds.includes(r.id) ? { ...r, login_created: true } : r)))
    }
    const failed = results.filter((r) => !r.ok)
    if (failed.length) {
      alert(`Could not create login for: ${failed.map((f) => f.email).join(', ')}\n\n${failed[0].message}`)
    } else {
      alert(`Dashboard created.\nAn email was sent to ${pendingEmails.map((e) => e.email).join(', ')} with step-by-step instructions to set their password via "Forgot password?".`)
    }
    setCreatingLoginId(null)
  }

  async function updateEmail(emailRow) {
    const email = editingEmailValue.trim().toLowerCase()
    if (!email || email === emailRow.email) { setEditingEmailId(null); return }
    setSavingEditEmail(true)
    const { data, error } = await supabase
      .from('student_emails').update({ email }).eq('id', emailRow.id).select()
    if (error) {
      alert(`Failed to update email: ${error.message}`)
    } else if (!data || data.length === 0) {
      alert("Update was blocked by Supabase (likely a Row Level Security policy) — the email was not changed.")
    } else {
      setStudents((prev) => prev.map((s) => (s.id === emailRow.id ? { ...s, email } : s)))
      setEditingEmailId(null)
      setEditingEmailValue('')
    }
    setSavingEditEmail(false)
  }

  async function updateSourceId(emailRow) {
    const raw = editingSourceIdValue.trim()
    const sourceId = raw === '' ? null : Number(raw)
    if (raw !== '' && !Number.isFinite(sourceId)) { alert('ID must be a number.'); return }
    setSavingSourceId(true)
    const { data, error } = await supabase
      .from('student_emails').update({ source_id: sourceId }).eq('id', emailRow.id).select()
    if (error) {
      alert(`Failed to update ID: ${error.message}`)
    } else if (!data || data.length === 0) {
      alert("Update was blocked by Supabase (likely a Row Level Security policy) — the ID was not changed.")
    } else {
      setStudents((prev) => prev.map((s) => (s.id === emailRow.id ? { ...s, source_id: sourceId } : s)))
      setEditingSourceIdRow(null)
      setEditingSourceIdValue('')
    }
    setSavingSourceId(false)
  }

  async function updatePhone(student) {
    const phone = editingPhoneValue.trim() || null
    setSavingPhone(true)
    const { data, error } = await supabase
      .from('student_emails').update({ phone }).eq('student_id', student.student_id).select('id')
    if (error) {
      alert(`Failed to update phone number: ${error.message}`)
    } else if (!data || data.length === 0) {
      alert("Update was blocked by Supabase (likely a Row Level Security policy) — the phone number was not changed.")
    } else {
      setStudents((prev) => prev.map((s) => (s.student_id === student.student_id ? { ...s, phone } : s)))
      setEditingPhoneStudentId(null)
      setEditingPhoneValue('')
    }
    setSavingPhone(false)
  }

  async function removeEmail(emailRow) {
    setDeletingEmailId(emailRow.id)
    const { data, error } = await supabase.from('student_emails').delete().eq('id', emailRow.id).select('id')
    if (error) {
      alert(`Failed to remove email: ${error.message}`)
    } else if (!data || data.length === 0) {
      alert("Delete was blocked by Supabase (likely a Row Level Security policy) — the email was not removed.")
    } else {
      setStudents((prev) => prev.filter((s) => s.id !== emailRow.id))
    }
    setDeletingEmailId(null)
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: DARK }}>
        <div className="text-center">
          <div className="w-14 h-14 rounded-2xl overflow-hidden mx-auto mb-4" style={{ background: NAV }}>
            <img src="/shivang.png" alt="Saraswati Vidyamandir" className="w-full h-full object-cover" />
          </div>
          <p className="font-semibold text-sm" style={{ color: GOLD }}>Loading data…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen" style={{ background: DARK }}>
      {/* Navbar */}
      <nav className="px-5 py-3 flex items-center justify-between" style={{ background: NAV, color: 'var(--text)', borderBottom: '2px solid rgba(200,134,10,0.35)', boxShadow: '0 4px 16px rgba(0,0,0,0.2)' }}>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl overflow-hidden flex-shrink-0" style={{ background: GOLD }}>
            <img src="/shivang.png" alt="Saraswati Vidyamandir" className="w-full h-full object-cover" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm hidden sm:block">Saraswati Vidyamandir</span>
              <span className="font-bold text-sm sm:hidden">SVM</span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold" style={{ background: 'rgba(200,134,10,0.2)', color: GOLD, border: `1px solid rgba(200,134,10,0.5)` }}>Teacher</span>
            </div>
            <p className="text-[10px] hidden sm:block mt-0.5" style={{ color: 'var(--faint)' }}>Student Report Portal</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs hidden sm:block" style={{ color: 'var(--faint)' }}>{session?.email}</span>
          <ThemeToggle />
          <button
            onClick={logout}
            className="text-xs px-3 py-1.5 rounded-lg transition font-medium border"
            style={{ background: 'transparent', borderColor: 'rgba(200,134,10,0.3)', color: 'var(--muted)' }}
            onMouseEnter={(e) => { e.currentTarget.style.background = GOLD; e.currentTarget.style.borderColor = GOLD; e.currentTarget.style.color = 'white' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'rgba(200,134,10,0.3)'; e.currentTarget.style.color = 'var(--muted)' }}
          >
            Logout
          </button>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto p-3 sm:p-6 space-y-5">
        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="Total Students" value={scope.length} type="gold" />
          <StatCard label="Class Average" value={classAvg !== 'N/A' ? `${classAvg}%` : 'N/A'} type="green" />
          <StatCard label="Class 9 Students" value={studentSummary.filter((s) => s.class === 9).length} type="brown" />
          <StatCard label="Class 10 Students" value={studentSummary.filter((s) => s.class === 10).length} type="brown2" />
        </div>

        {/* ── Sidebar + Content layout ── */}
        <div className="md:flex md:gap-5 md:items-start">

          {/* Left sidebar — vertical tabs */}
          <div className="md:w-52 md:flex-shrink-0 mb-3 md:mb-0">
            <div className="rounded-xl border overflow-hidden flex md:flex-col" style={{ background: NAV, borderColor: 'rgba(200,134,10,0.2)' }}>
              {[
                { k: 'students', label: 'Students', icon: '👥' },
                { k: 'analysis', label: 'Analysis', icon: '📊' },
                { k: 'tests',    label: 'Tests',    icon: '📋' },
                { k: 'toppers',  label: 'Toppers',  icon: '🏆' },
                { k: 'assignments', label: 'Worksheets', icon: '📌' },
                { k: 'worksheetInsights', label: 'Worksheet Performance', icon: '📈' },
                { k: 'manage',   label: 'Other',    icon: '⚙️' },
              ].map(({ k, label, icon }) => (
                <button
                  key={k}
                  onClick={() => setView(k)}
                  className="flex-1 md:flex-none flex items-center justify-center md:justify-start gap-3 px-3 md:px-5 py-3 md:py-4 text-xs md:text-sm font-semibold transition-all border-b md:border-b-0 md:border-l-[3px] last:border-b-0"
                  style={view === k
                    ? { borderColor: GOLD, color: GOLD, background: 'rgba(200,134,10,0.12)' }
                    : { borderColor: 'rgba(200,134,10,0.1)', color: 'var(--fainter)' }
                  }
                >
                  <span className="text-base leading-none">{icon}</span>
                  <span className="hidden sm:inline">{label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Right: filter bar + content */}
          <div className="flex-1 min-w-0 space-y-4">

            {/* Filter bar (no view toggle) */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 px-3 py-2.5 flex flex-wrap gap-2 items-center">
              {/* Class filter */}
              {view !== 'assignments' && (
                <div className="flex bg-gray-50 rounded-lg border border-gray-200 p-1 gap-1">
                  {['All', '9', '10'].map((c) => (
                    <button
                      key={c}
                      onClick={() => setClassFilter(c)}
                      className="px-4 py-1.5 rounded-md text-sm font-medium transition"
                      style={classFilter === c ? { background: GOLD, color: 'white' } : { color: 'var(--text)' }}
                    >
                      {c === 'All' ? 'All Classes' : `Class ${c}`}
                    </button>
                  ))}
                </div>
              )}
              {view === 'assignments' && (
                <div className="flex bg-gray-50 rounded-lg border border-gray-200 p-1 gap-1">
                  {['9', '10'].map((c) => (
                    <button
                      key={c}
                      onClick={() => setAssignmentClass(c)}
                      className="px-4 py-1.5 rounded-md text-sm font-medium transition"
                      style={assignmentClass === c ? { background: GOLD, color: 'white' } : { color: 'var(--text)' }}
                    >
                      {`Class ${c}`}
                    </button>
                  ))}
                </div>
              )}
              {view === 'assignments' && (
                <div className="flex bg-gray-50 rounded-lg border border-gray-200 p-1 gap-1">
                  {[
                    { key: 'deadline-desc', label: 'Newest' },
                    { key: 'deadline-asc',  label: 'Oldest' },
                    { key: 'subject',       label: 'Subject' },
                    { key: 'title',         label: 'A–Z' },
                  ].map(({ key, label }) => (
                    <button
                      key={key}
                      onClick={() => setAssignmentSort(key)}
                      className="px-3 py-1.5 rounded-md text-sm font-medium transition"
                      style={assignmentSort === key ? { background: GOLD, color: 'white' } : { color: 'var(--text)' }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
              {(view === 'students' || view === 'manage' || view === 'assignments') && (
                <input
                  type="text"
                  placeholder={view === 'assignments' ? 'Search worksheet…' : 'Search student…'}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="border border-gray-200 rounded-lg px-4 py-2 text-sm focus:outline-none bg-gray-50"
                  onFocus={(e) => e.target.style.boxShadow = `0 0 0 2px ${GOLD}40`}
                  onBlur={(e) => e.target.style.boxShadow = ''}
                />
              )}
              {view === 'tests' && (
                <>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-semibold text-gray-400">Threshold</span>
                    <select
                      value={topPctFilter}
                      onChange={(e) => setTopPctFilter(e.target.value)}
                      className="border border-gray-200 rounded-lg px-2.5 py-2 text-xs font-medium bg-gray-50 focus:outline-none"
                      style={{ color: 'var(--text)' }}
                    >
                      {Array.from({ length: 11 }, (_, i) => i * 10).map((p) => (
                        <option key={p} value={p}>{p === 0 ? 'Any (0%)' : `≥${p}%`}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-semibold text-gray-400">Top</span>
                    <div className="flex bg-gray-50 rounded-lg border border-gray-200 p-1 gap-1">
                      {['10', '20', '30', '40', 'any'].map((n) => (
                        <button
                          key={n}
                          onClick={() => setTopNFilter(n)}
                          className="px-3 py-1.5 rounded-md text-xs font-medium transition"
                          style={topNFilter === n ? { background: GOLD, color: 'white' } : { color: 'var(--text)' }}
                        >
                          {n === 'any' ? 'Any' : n}
                        </button>
                      ))}
                    </div>
                  </div>
                  <button
                    onClick={() => setFormatModalOpen(true)}
                    className="text-xs font-semibold px-3 py-2 rounded-lg border transition"
                    style={{ color: GOLD, borderColor: GOLD }}
                  >
                    🎨 Format
                  </button>
                </>
              )}
              <span className="text-sm text-gray-400 ml-auto">
                {view === 'students' ? `${filtered.length} students` : view === 'tests' ? `${filteredTests.length} tests` : view === 'manage' ? `${studentList.length} students` : view === 'assignments' ? `${filteredAssignments.length} worksheets` : ''}
              </span>
            </div>

        {/* Analysis view */}
        {view === 'analysis' && (() => {
          const sciChapters   = chapterStats.filter((t) => t.subject === 'Science')
          const mathChapters  = chapterStats.filter((t) => t.subject === 'Maths')
          const strongChapters   = chapterStats.filter((t) => t.avg >= 80).sort((a, b) => b.avg - a.avg)
          const moderateChapters = chapterStats.filter((t) => t.avg >= 60 && t.avg < 80).sort((a, b) => b.avg - a.avg)
          const weakChapters     = chapterStats.filter((t) => t.avg < 60).sort((a, b) => a.avg - b.avg)

          return (
            <div className="space-y-5">
              {/* Charts */}
              <div className="grid md:grid-cols-2 gap-4">
                {[{ label: 'Science', color: '#16a34a', data: sciChapters }, { label: 'Maths', color: '#c8860a', data: mathChapters }].map(({ label, color, data }) =>
                  data.length > 0 && (
                    <div key={label} className="bg-white rounded-xl shadow p-4">
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-sm font-semibold flex items-center gap-1.5" style={{ color }}>
                          <span className="inline-block w-1 h-4 rounded-full flex-shrink-0" style={{ background: color }} />
                          {label} — Chapter Analysis
                        </p>
                        <div className="flex items-center gap-2 text-[10px] text-gray-400 flex-wrap">
                          <span><span className="inline-block w-3 h-2 rounded-sm mr-1" style={{ background: '#16a34a' }} />≥80%</span>
                          <span><span className="inline-block w-3 h-2 rounded-sm mr-1" style={{ background: '#c8860a' }} />60–79%</span>
                          <span><span className="inline-block w-3 h-2 rounded-sm mr-1" style={{ background: '#ef4444' }} />&lt;60%</span>
                          <span className="border-l pl-2">line = tests</span>
                        </div>
                      </div>
                      <ChapterBarChart topics={data.map((t) => ({ ...t, count: t.testCount }))} />
                    </div>
                  )
                )}
              </div>

              {/* Filter bar */}
              <div className="bg-white rounded-xl shadow px-4 py-2.5 flex flex-wrap items-center gap-3">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Subject</span>
                <div className="flex gap-1">
                  {['All', 'Maths', 'Science'].map((s) => (
                    <button
                      key={s}
                      onClick={() => setChapterSubject(s)}
                      className="px-3 py-1 rounded-full text-xs font-semibold transition-all"
                      style={chapterSubject === s
                        ? { background: GOLD, color: '#fff' }
                        : { background: 'rgba(200,134,10,0.1)', color: 'var(--faint)' }
                      }
                    >{s}</button>
                  ))}
                </div>
                <span className="text-xs text-gray-400 ml-auto">
                  {chapterSubject === 'All'
                    ? `${chapterStats.length} chapters total`
                    : `${chapterStats.filter((t) => t.subject === chapterSubject).length} ${chapterSubject} chapters`}
                </span>
              </div>

              {/* Strong / Moderate / Weak sortable tables */}
              {(() => {
                const cols = [
                  { col: 'topic',     label: 'Chapter / Topic', center: false },
                  { col: 'subject',   label: 'Subject',         center: false },
                  { col: 'testCount', label: 'Tests',           center: true  },
                  { col: 'avg',       label: 'Class Avg %',     center: true  },
                  { col: 'best',      label: 'Best',            center: true  },
                  { col: 'worst',     label: 'Worst',           center: true  },
                ]
                function applySortTo(data) {
                  const filtered = chapterSubject === 'All' ? data : data.filter((t) => t.subject === chapterSubject)
                  const { col, dir } = chapterSort
                  return [...filtered].sort((a, b) => {
                    const av = a[col]; const bv = b[col]
                    if (typeof av === 'string') return dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
                    return dir === 'asc' ? av - bv : bv - av
                  })
                }
                function onColClick(col) {
                  setChapterSort((prev) => ({ col, dir: prev.col === col && prev.dir === 'desc' ? 'asc' : 'desc' }))
                }
                return [
                  { label: '🏆 Strong Chapters',  data: applySortTo(strongChapters),   type: 'strong',   empty: 'No chapters above 80% yet.' },
                  { label: '🟡 Moderate Chapters', data: applySortTo(moderateChapters), type: 'moderate', empty: 'No moderate chapters.' },
                  { label: '⚠️ Weak Chapters',     data: applySortTo(weakChapters),     type: 'weak',     empty: 'No weak chapters — great work!' },
                ].map(({ label, data, type, empty }) => {
                  const hdrBg   = type === 'strong' ? 'rgba(22,163,74,0.12)'  : type === 'moderate' ? 'rgba(200,134,10,0.12)'  : 'rgba(239,68,68,0.12)'
                  const rowBg   = type === 'strong' ? 'rgba(22,163,74,0.06)'  : type === 'moderate' ? 'rgba(200,134,10,0.06)'  : 'rgba(239,68,68,0.06)'
                  const hdrColor = type === 'strong' ? '#4ade80' : type === 'moderate' ? '#c8860a' : '#f87171'
                  const barColor = type === 'strong' ? '#16a34a' : type === 'moderate' ? '#c8860a' : '#ef4444'
                  const valColor = type === 'strong' ? '#4ade80' : type === 'moderate' ? '#c8860a' : '#f87171'
                  return (
                    <div key={type} className="bg-white rounded-xl shadow overflow-hidden">
                      <div className="px-5 py-3 border-b" style={{ background: hdrBg }}>
                        <p className="text-sm font-semibold" style={{ color: hdrColor }}>{label} ({data.length})</p>
                      </div>
                      {data.length === 0
                        ? <p className="text-sm text-gray-400 py-6 text-center">{empty}</p>
                        : (
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="text-xs text-gray-500 uppercase" style={{ background: rowBg }}>
                                  {cols.map((c) => (
                                    <th
                                      key={c.col}
                                      onClick={() => onColClick(c.col)}
                                      className={`px-5 py-2 select-none ${c.center ? 'text-center' : 'text-left'}`}
                                      style={{ cursor: 'pointer', whiteSpace: 'nowrap', userSelect: 'none' }}
                                    >
                                      {c.label}{' '}
                                      <span style={{ color: chapterSort.col === c.col ? GOLD : 'rgba(200,134,10,0.3)', fontSize: '10px' }}>
                                        {chapterSort.col === c.col ? (chapterSort.dir === 'asc' ? '▲' : '▼') : '⇅'}
                                      </span>
                                    </th>
                                  ))}
                                  <th className="px-5 py-2 text-left text-xs text-gray-500 uppercase">Progress</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-50">
                                {data.map((t) => (
                                  <tr key={`${t.subject}-${t.topic}`} className={type === 'strong' ? 'hover:bg-green-50' : type === 'moderate' ? 'hover:bg-amber-50' : 'hover:bg-red-50'}>
                                    <td className="px-5 py-2 font-medium text-gray-800 text-xs">{t.topic}</td>
                                    <td className="px-5 py-2">
                                      <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${t.subject === 'Science' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>{t.subject}</span>
                                    </td>
                                    <td className="px-5 py-2 text-center text-gray-600 text-xs">{t.testCount}</td>
                                    <td className="px-5 py-2 text-center"><span className="font-bold text-sm" style={{ color: valColor }}>{t.avg}%</span></td>
                                    <td className="px-5 py-2 text-center text-xs font-medium" style={{ color: '#4ade80' }}>{t.best}%</td>
                                    <td className="px-5 py-2 text-center text-xs font-medium" style={{ color: '#f87171' }}>{t.worst}%</td>
                                    <td className="px-5 py-2 w-28">
                                      <div className="w-full bg-gray-100 rounded-full h-1.5">
                                        <div className="h-1.5 rounded-full" style={{ width: `${t.avg}%`, background: barColor }} />
                                      </div>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )
                      }
                    </div>
                  )
                })
              })()}
            </div>
          )
        })()}

        {/* ── Worksheet Performance tab ── */}
        {view === 'worksheetInsights' && (() => {
          const { strong: strongWs, moderate: moderateWs, weak: weakWs } = classifyChapters(worksheetChapterStats)
          const sciWs  = worksheetSubjectStats.find((s) => s.subject === 'Science')
          const mathWs = worksheetSubjectStats.find((s) => s.subject === 'Maths')
          const sciWsChapters  = worksheetChapterStats.filter((t) => t.subject === 'Science')
          const mathWsChapters = worksheetChapterStats.filter((t) => t.subject === 'Maths')

          function issuesFor(chapterStat) {
            return topRecurringIssues(
              worksheetPerfInScope.filter((r) => r.subject === chapterStat.subject && r.chapter === chapterStat.topic),
              { limit: 1 }
            )
          }

          if (worksheetChapterStats.length === 0) {
            return (
              <div className="bg-white rounded-xl shadow p-8 text-center">
                <p className="text-sm text-gray-500">No graded worksheet feedback with a clear signal yet.</p>
                <p className="text-xs text-gray-400 mt-1">This fills in as worksheets get graded and the AI feedback mentions specific strengths or mistakes.</p>
              </div>
            )
          }

          return (
            <div className="space-y-5">
              {/* Subject-wise summary */}
              <div className="grid grid-cols-2 gap-3">
                <MiniStat label="Science — Worksheet Avg" value={sciWs ? `${sciWs.avg}%` : '—'} highlight />
                <MiniStat label="Maths — Worksheet Avg"   value={mathWs ? `${mathWs.avg}%` : '—'} highlight />
              </div>

              {/* Charts */}
              <div className="grid md:grid-cols-2 gap-4">
                {[{ label: 'Science', color: '#16a34a', data: sciWsChapters }, { label: 'Maths', color: '#c8860a', data: mathWsChapters }].map(({ label, color, data }) =>
                  data.length > 0 && (
                    <div key={label} className="bg-white rounded-xl shadow p-4">
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-sm font-semibold flex items-center gap-1.5" style={{ color }}>
                          <span className="inline-block w-1 h-4 rounded-full flex-shrink-0" style={{ background: color }} />
                          {label} — Worksheet Chapter Analysis
                        </p>
                        <div className="flex items-center gap-2 text-[10px] text-gray-400 flex-wrap">
                          <span><span className="inline-block w-3 h-2 rounded-sm mr-1" style={{ background: '#16a34a' }} />≥80%</span>
                          <span><span className="inline-block w-3 h-2 rounded-sm mr-1" style={{ background: '#c8860a' }} />60–79%</span>
                          <span><span className="inline-block w-3 h-2 rounded-sm mr-1" style={{ background: '#ef4444' }} />&lt;60%</span>
                        </div>
                      </div>
                      <ChapterBarChart topics={data} />
                    </div>
                  )
                )}
              </div>

              {/* Filter bar */}
              <div className="bg-white rounded-xl shadow px-4 py-2.5 flex flex-wrap items-center gap-3">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Subject</span>
                <div className="flex gap-1">
                  {['All', 'Maths', 'Science'].map((s) => (
                    <button
                      key={s}
                      onClick={() => setWsChapterSubject(s)}
                      className="px-3 py-1 rounded-full text-xs font-semibold transition-all"
                      style={wsChapterSubject === s
                        ? { background: GOLD, color: '#fff' }
                        : { background: 'rgba(200,134,10,0.1)', color: 'var(--faint)' }
                      }
                    >{s}</button>
                  ))}
                </div>
                <span className="text-xs text-gray-400 ml-auto">
                  {wsChapterSubject === 'All'
                    ? `${worksheetChapterStats.length} chapters total`
                    : `${worksheetChapterStats.filter((t) => t.subject === wsChapterSubject).length} ${wsChapterSubject} chapters`}
                </span>
              </div>

              {/* Strong / Moderate / Weak tables */}
              {(() => {
                function inSubject(data) {
                  return wsChapterSubject === 'All' ? data : data.filter((t) => t.subject === wsChapterSubject)
                }
                return [
                  { label: '🏆 Strong Chapters',  data: inSubject(strongWs),   type: 'strong',   empty: 'No chapters above 80% yet.' },
                  { label: '🟡 Moderate Chapters', data: inSubject(moderateWs), type: 'moderate', empty: 'No moderate chapters.' },
                  { label: '⚠️ Weak Chapters',     data: inSubject(weakWs),     type: 'weak',     empty: 'No weak chapters — great work!' },
                ].map(({ label, data, type, empty }) => {
                  const hdrBg = type === 'strong' ? 'rgba(22,163,74,0.12)' : type === 'moderate' ? 'rgba(200,134,10,0.12)' : 'rgba(239,68,68,0.12)'
                  const hdrColor = type === 'strong' ? '#4ade80' : type === 'moderate' ? '#c8860a' : '#f87171'
                  return (
                    <div key={type} className="bg-white rounded-xl shadow overflow-hidden">
                      <div className="px-5 py-3 border-b" style={{ background: hdrBg }}>
                        <p className="text-sm font-semibold" style={{ color: hdrColor }}>{label} ({data.length})</p>
                      </div>
                      {data.length === 0
                        ? <p className="text-sm text-gray-400 py-6 text-center">{empty}</p>
                        : <div className="p-3"><ModalTopicTable topics={data} type={type} countLabel="Worksheets" /></div>
                      }
                    </div>
                  )
                })
              })()}

              {/* Recurring mistake patterns */}
              <div className="bg-white rounded-xl shadow p-4">
                <p className="text-sm font-semibold text-gray-700 mb-3">⚠️ Recurring Mistake Patterns</p>
                {worksheetRecurringIssues.length === 0
                  ? <p className="text-xs text-gray-400">No clear recurring mistake pattern detected yet.</p>
                  : (
                    <div className="space-y-2">
                      {worksheetRecurringIssues.map((issue) => (
                        <div key={issue.key} className="flex items-start justify-between gap-3 border border-gray-100 rounded-lg px-3 py-2">
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-gray-700">{issue.label}</p>
                            <p className="text-[11px] text-gray-400 mt-0.5 truncate">"{issue.example}"</p>
                          </div>
                          <span className="text-xs font-bold flex-shrink-0" style={{ color: GOLD }}>{issue.count}×</span>
                        </div>
                      ))}
                    </div>
                  )
                }
              </div>

              {/* Suggested revision plan */}
              <div className="bg-white rounded-xl shadow p-4">
                <p className="text-sm font-semibold text-gray-700 mb-3">💡 Suggested Revision Plan</p>
                {[...weakWs, ...moderateWs].length === 0
                  ? <p className="text-xs text-gray-400">No chapters need revision right now — nice work.</p>
                  : (
                    <div className="space-y-2">
                      {[...weakWs, ...moderateWs].map((c) => (
                        <div key={`${c.subject}-${c.topic}`} className="text-xs border border-gray-100 rounded-lg px-3 py-2 bg-gray-50">
                          {buildSuggestion(c, issuesFor(c), { audience: 'teacher' })}
                        </div>
                      ))}
                    </div>
                  )
                }
              </div>
            </div>
          )
        })()}

        {/* Toppers board */}
        {view === 'toppers' && (() => {
          const top9  = studentSummary.filter((s) => s.class === 9  && s.avgPct !== null).sort((a, b) => Number(b.avgPct) - Number(a.avgPct))
          const top10 = studentSummary.filter((s) => s.class === 10 && s.avgPct !== null).sort((a, b) => Number(b.avgPct) - Number(a.avgPct))

function ini(name) {
            return name ? name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase() : '?'
          }

          // Slot definitions: display order is left(#2), center(#1), right(#3)
          const SLOTS = [
            { idx: 1, rank: 2, medal: '🥈', color: '#B8B8B8', avatarBg: '#5a5a5a', blockH: 76  },
            { idx: 0, rank: 1, medal: '🥇', color: '#FFD700', avatarBg: '#b8860b', blockH: 120 },
            { idx: 2, rank: 3, medal: '🥉', color: '#CD7F32', avatarBg: '#8B4513', blockH: 48  },
          ]

          function ClassPodium({ students, label }) {
            const top3 = students.slice(0, 3)
            const rest = students.slice(3, 10)
            return (
              <div style={{ flex: 1, minWidth: 0 }}>
                {/* Class label */}
                <div style={{ textAlign: 'center', marginBottom: '24px' }}>
                  <span style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '3px', color: 'var(--faint)', textTransform: 'uppercase' }}>Class</span>
                  <div style={{ fontSize: '28px', fontWeight: 900, color: GOLD, lineHeight: 1.1 }}>{label}</div>
                </div>

                {/* Podium stage */}
                <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: '10px', marginBottom: '24px', paddingBottom: '4px' }}>
                  {SLOTS.map(({ idx, rank, medal, color, avatarBg, blockH }) => {
                    const s = top3[idx]
                    if (!s) return <div key={rank} style={{ width: '96px' }} />
                    return (
                      <div key={s.student_id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '96px' }}>
                        <div style={{ fontSize: '22px', marginBottom: '4px' }}>{medal}</div>
                        <div style={{
                          width: '60px', height: '60px', borderRadius: '50%',
                          background: avatarBg, color: '#fff', fontWeight: 900, fontSize: '18px',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          boxShadow: `0 0 18px ${color}66`,
                          marginBottom: '8px', flexShrink: 0,
                        }}>{ini(s.student_name)}</div>
                        <div style={{ color: 'var(--text)', fontWeight: 700, fontSize: '11px', textAlign: 'center', lineHeight: '1.3', marginBottom: '4px', wordBreak: 'break-word' }}>
                          {s.student_name}
                        </div>
                        <div style={{ color, fontWeight: 900, fontSize: '14px', marginBottom: '8px' }}>{s.avgPct}%</div>
                        <div style={{
                          width: '100%', height: `${blockH}px`,
                          borderRadius: '10px 10px 0 0',
                          background: `linear-gradient(to top, ${color}35, ${color}0c)`,
                          border: `1px solid ${color}50`, borderBottom: 'none',
                          display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
                          paddingBottom: '8px',
                        }}>
                          <span style={{ color, fontWeight: 900, fontSize: '13px' }}>#{rank}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* Ranks 4–10 */}
                {rest.map((s, i) => (
                  <div key={s.student_id} style={{
                    display: 'flex', alignItems: 'center', gap: '10px',
                    padding: '9px 14px', borderRadius: '10px', marginBottom: '6px',
                    background: 'rgba(200,134,10,0.07)', border: '1px solid rgba(200,134,10,0.15)',
                  }}>
                    <span style={{ color: 'var(--faint)', fontWeight: 700, fontSize: '11px', width: '22px', flexShrink: 0 }}>#{i + 4}</span>
                    <div style={{
                      width: '30px', height: '30px', borderRadius: '50%',
                      background: GOLD, color: '#fff', fontWeight: 900, fontSize: '11px',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    }}>{ini(s.student_name)}</div>
                    <span style={{ color: 'var(--text)', fontWeight: 600, fontSize: '13px', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {s.student_name}
                    </span>
                    <span style={{ color: Number(s.avgPct) >= 80 ? '#4ade80' : Number(s.avgPct) >= 60 ? GOLD : '#f87171', fontWeight: 700, fontSize: '13px', flexShrink: 0 }}>
                      {s.avgPct}%
                    </span>
                  </div>
                ))}

                {students.length === 0 && (
                  <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--faint)', fontSize: '13px' }}>No data yet</div>
                )}
              </div>
            )
          }

          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--faint)', textTransform: 'uppercase', letterSpacing: '1px' }}>
                  Ranked by overall average · min. 1 test
                </span>
              </div>

              <div style={{
                background: DARK,
                border: '1px solid rgba(200,134,10,0.25)',
                borderRadius: '20px',
                padding: '32px 28px 28px',
              }}>
                {/* Header */}
                <div style={{ textAlign: 'center', marginBottom: '32px' }}>
                  <div style={{
                    display: 'inline-flex', alignItems: 'center', gap: '8px',
                    background: 'rgba(200,134,10,0.14)', border: '1px solid rgba(200,134,10,0.32)',
                    borderRadius: '999px', padding: '8px 20px', marginBottom: '8px',
                  }}>
                    <span style={{ fontSize: '18px' }}>🏆</span>
                    <span style={{ color: GOLD, fontWeight: 900, fontSize: '13px', letterSpacing: '3px', textTransform: 'uppercase' }}>
                      Saraswati Vidyamandir
                    </span>
                  </div>
                  <div style={{ color: 'var(--fainter)', fontSize: '12px', marginTop: '4px' }}>Top Performers — All Time</div>
                </div>

                {/* Two class columns */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1px 1fr', gap: '0 24px' }}>
                  <ClassPodium students={top9}  label="9" />
                  <div style={{ background: 'rgba(200,134,10,0.18)', margin: '0 auto', width: '1px', minHeight: '100%' }} />
                  <ClassPodium students={top10} label="10" />
                </div>
              </div>
            </div>
          )
        })()}

        {/* Tests table */}
        {view === 'tests' && (
          <div className="bg-white rounded-xl shadow overflow-hidden">
            <div className="overflow-x-hidden">
              <table className="w-full text-sm">
                <thead>
                  {(() => {
                    const SI = ({ col }) => (
                      <span className="ml-1" style={{ color: testSort.col === col ? GOLD : 'rgba(200,134,10,0.35)', fontSize: '9px' }}>
                        {testSort.col === col ? (testSort.dir === 'asc' ? '▲' : '▼') : '⇅'}
                      </span>
                    )
                    const TH = ({ col, className = '', children }) => (
                      <th
                        className={`px-2 py-3 cursor-pointer select-none hover:text-amber-400 transition-colors whitespace-nowrap ${className}`}
                        onClick={() => toggleTestSort(col)}
                      >
                        {children}<SI col={col} />
                      </th>
                    )
                    return (
                      <tr className="text-left text-xs text-gray-500 uppercase tracking-wide" style={{ background: NAV }}>
                        <TH col="testNo" className="text-center">#</TH>
                        <TH col="date">Date</TH>
                        <TH col="subject">Subject</TH>
                        <TH col="topic">Topic</TH>
                        <TH col="class" className="text-center">Class</TH>
                        <TH col="total_marks" className="text-center">Total</TH>
                        <TH col="appearedCount" className="text-center">Students</TH>
                        <TH col="topCount70" className="text-center">
                          <span title={`Top ${topPctFilter === '0' ? '' : `≥${topPctFilter}%`}${topNFilter !== 'any' ? ` (≤${topNFilter})` : ''}`}>Top</span>
                        </TH>
                        <th className="px-2 py-3 text-center whitespace-nowrap">Edit</th>
                        <th className="px-2 py-3 text-center whitespace-nowrap">Delete</th>
                        <th className="px-2 py-3 text-center whitespace-nowrap">Send</th>
                      </tr>
                    )
                  })()}
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {sortedTests.map((t) => {
                    const { appearedCount, topCount70: topCount } = t
                    const isSending = sending === t.key
                    const result = sendResult?.key === t.key ? sendResult : null
                    return (
                      <tr key={t.key} className="hover:bg-amber-50">
                        <td className="px-2 py-3 text-center font-bold text-gray-400 text-xs">#{t.testNo}</td>
                        <td className="px-2 py-3 text-gray-600 text-xs whitespace-nowrap">{t.date}</td>
                        <td className="px-2 py-3">
                          <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${t.subject === 'Science' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>{t.subject}</span>
                        </td>
                        <td className="px-2 py-3 text-gray-700 text-xs max-w-[130px] truncate" title={t.topic}>{t.topic}</td>
                        <td className="px-2 py-3 text-center">
                          <span className="px-2 py-0.5 rounded-full text-xs font-bold text-white" style={{ background: GOLD }}>{t.class}</span>
                        </td>
                        <td className="px-2 py-3 text-center font-medium text-gray-700">{t.total_marks}</td>
                        <td className="px-2 py-3 text-center text-gray-600 text-xs">{appearedCount}/{t.scores.length}</td>
                        <td className="px-2 py-3 text-center">
                          <span className={`font-semibold text-xs ${topCount > 0 ? 'text-green-600' : 'text-gray-400'}`}>{topCount}</span>
                        </td>
                        <td className="px-2 py-3 text-center">
                          <button
                            onClick={() => setEditingTest(t)}
                            title="Edit test"
                            className="text-sm px-2 py-1.5 rounded-lg border transition"
                            style={{ color: GOLD, borderColor: GOLD }}
                          >
                            ✏️
                          </button>
                        </td>
                        <td className="px-2 py-3 text-center">
                          <button
                            onClick={() => setDeletingTest(t)}
                            disabled={deletingTestKey === t.key}
                            title="Delete test"
                            className="text-sm px-2 py-1.5 rounded-lg border border-red-300 text-red-500 hover:bg-red-50 transition disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            {deletingTestKey === t.key ? '…' : '🗑️'}
                          </button>
                        </td>
                        <td className="px-2 py-3 text-center">
                          {isSending ? (
                            <span className="text-xs text-amber-600 font-medium">Sending…</span>
                          ) : result && !result.success ? (
                            <div className="flex flex-col items-center gap-1">
                              <span className="text-xs text-red-500 font-medium">✗ Failed</span>
                              <button onClick={() => openPreview(t)} className="text-xs font-medium" style={{ color: GOLD }}>Retry</button>
                            </div>
                          ) : sentReports[t.key] ? (
                            <div className="flex flex-col items-center gap-1">
                              <span className="text-xs text-green-600 font-semibold">✓ Sent</span>
                              <span className="text-[10px] text-gray-400">{new Date(sentReports[t.key]).toLocaleDateString('en-US', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                              <button onClick={() => openPreview(t)} className="text-[10px] font-medium px-2 py-0.5 rounded border" style={{ color: GOLD, borderColor: GOLD }}>↺ Re-send</button>
                            </div>
                          ) : (
                            <button
                              onClick={() => openPreview(t)}
                              className="text-xs font-semibold px-2.5 py-1.5 rounded-lg text-white transition"
                              style={{ background: GOLD }}
                            >
                              📤 Send
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {filteredTests.length === 0 && (
                <p className="text-center text-gray-400 py-10">No tests found.</p>
              )}
            </div>
          </div>
        )}

        {/* Student table */}
        {view === 'students' && <div className="bg-white rounded-xl shadow overflow-hidden">
          <div className="overflow-x-hidden">
            <table className="w-full text-sm">
              <thead>
                {(() => {
                  const SI = ({ col }) => (
                    <span className="ml-1" style={{ color: studentSort.col === col ? GOLD : 'rgba(200,134,10,0.35)', fontSize: '9px' }}>
                      {studentSort.col === col ? (studentSort.dir === 'asc' ? '▲' : '▼') : '⇅'}
                    </span>
                  )
                  const TH = ({ col, className = '', children, style }) => (
                    <th
                      className={`px-3 sm:px-5 py-3 cursor-pointer select-none hover:text-amber-400 transition-colors ${className}`}
                      style={style}
                      onClick={() => toggleStudentSort(col)}
                    >
                      {children}<SI col={col} />
                    </th>
                  )
                  return (
                    <tr className="text-left text-xs text-gray-500 uppercase tracking-wide" style={{ background: NAV }}>
                      <TH col="student_name">Student</TH>
                      <TH col="class" className="text-center">Class</TH>
                      <TH col="rank" className="text-center">Rank</TH>
                      <TH col="totalTests" className="text-center hidden sm:table-cell">Tests</TH>
                      <TH col="avgPct" className="text-center">Avg %</TH>
                      <TH col="sciAvg" className="text-center hidden md:table-cell">Science</TH>
                      <TH col="mathAvg" className="text-center hidden md:table-cell">Maths</TH>
                      <th className="px-3 sm:px-5 py-3 text-center hidden lg:table-cell">Trend</th>
                      <TH col="positivePct" className="text-center hidden lg:table-cell" style={{ color: '#4ade80' }}>+ve %</TH>
                      <TH col="negativePct" className="text-center hidden lg:table-cell" style={{ color: '#f87171' }}>-ve %</TH>
                      <TH col="absentCount" className="text-center hidden sm:table-cell">Absent</TH>
                      <th className="px-3 sm:px-5 py-3 text-center hidden sm:table-cell">Detail</th>
                    </tr>
                  )
                })()}
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map((s) => (
                  <tr
                    key={s.student_id}
                    className="transition cursor-pointer hover:bg-amber-50"
                    onClick={() => setSelected(s)}
                  >
                    <td className="px-3 sm:px-5 py-3 font-medium text-gray-800 text-sm">{s.student_name}</td>
                    <td className="px-3 sm:px-5 py-3 text-center">
                      <span className="px-2 py-0.5 rounded-full text-xs font-bold text-white" style={{ background: GOLD }}>
                        {s.class}
                      </span>
                    </td>
                    <td className="px-3 sm:px-5 py-3 text-center">
                      {s.rank
                        ? <span className={`font-bold text-sm ${s.rank === 1 ? 'text-amber-500' : s.rank <= 3 ? 'text-amber-700' : 'text-gray-600'}`}>
                            {s.rank === 1 ? '🥇' : s.rank === 2 ? '🥈' : s.rank === 3 ? '🥉' : `#${s.rank}`}
                          </span>
                        : <span className="text-gray-300 text-xs">—</span>
                      }
                    </td>
                    <td className="px-3 sm:px-5 py-3 text-center text-gray-600 text-sm hidden sm:table-cell">{s.appeared}/{s.totalTests}</td>
                    <td className="px-3 sm:px-5 py-3 text-center"><PctBadge pct={s.avgPct} /></td>
                    <td className="px-3 sm:px-5 py-3 text-center hidden md:table-cell"><PctBadge pct={s.sciAvg} /></td>
                    <td className="px-3 sm:px-5 py-3 text-center hidden md:table-cell"><PctBadge pct={s.mathAvg} /></td>
                    <td className="px-3 sm:px-5 py-3 text-center hidden lg:table-cell">
                      {s.trend === 'up'
                        ? <span className="text-xs font-bold" style={{ color: '#4ade80' }}>▲ Up</span>
                        : s.trend === 'down'
                          ? <span className="text-xs font-bold" style={{ color: '#f87171' }}>▼ Down</span>
                          : s.trend === 'stable'
                            ? <span className="text-xs font-bold" style={{ color: '#c8860a' }}>→ Stable</span>
                            : <span className="text-xs" style={{ color: 'var(--faint)' }}>—</span>
                      }
                    </td>
                    <td className="px-3 sm:px-5 py-3 text-center hidden lg:table-cell">
                      {s.positivePct !== null
                        ? <span className="font-semibold text-sm" style={{ color: '#4ade80' }}>{s.positivePct}%</span>
                        : <span className="text-gray-300 text-xs">—</span>
                      }
                    </td>
                    <td className="px-3 sm:px-5 py-3 text-center hidden lg:table-cell">
                      {s.negativePct !== null
                        ? <span className="font-semibold text-sm" style={{ color: '#f87171' }}>{s.negativePct}%</span>
                        : <span className="text-gray-300 text-xs">—</span>
                      }
                    </td>
                    <td className="px-3 sm:px-5 py-3 text-center hidden sm:table-cell">
                      {s.absentCount > 0
                        ? <span className="text-red-500 font-medium">{s.absentCount}</span>
                        : <span className="text-green-500">0</span>
                      }
                    </td>
                    <td className="px-3 sm:px-5 py-3 text-center hidden sm:table-cell">
                      <button
                        onClick={(e) => { e.stopPropagation(); setSelected(s) }}
                        className="text-xs font-medium transition"
                        style={{ color: GOLD }}
                      >
                        View ›
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length === 0 && (
              <p className="text-center text-gray-400 py-10">No students found.</p>
            )}
          </div>
        </div>}

        {/* ── Assignments tab ── */}
        {view === 'assignments' && (
          <div className="space-y-4">
            <a
              href="https://n8n.saraswatividyamandir.com/form/64d64bc4-54e8-4921-ae7b-e112cc163726"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 text-sm font-semibold px-4 py-2.5 rounded-lg text-white transition"
              style={{ background: GOLD }}
            >
              📤 Upload Worksheet ↗
            </a>

            {/* ── Class-level summary (aggregate only — per-worksheet detail lives in the table below) ── */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
              <p className="text-sm font-semibold text-gray-700 mb-3">📊 Worksheet Analysis</p>
              <div className="grid grid-cols-2 gap-3">
                {assignmentAnalysis.perClass.map((c) => (
                  <div key={c.class} className="rounded-lg border border-gray-100 p-3">
                    <p className="text-xs text-gray-400 uppercase tracking-wide font-semibold mb-1">Class {c.class}</p>
                    <p className="text-2xl font-bold text-gray-800">{c.avgRate}%</p>
                    <p className="text-xs text-gray-500 mt-0.5">{c.assignmentCount} worksheet{c.assignmentCount === 1 ? '' : 's'} · {c.rosterSize} students</p>
                    <div className="w-full bg-gray-100 rounded-full h-1.5 mt-2">
                      <div className="h-1.5 rounded-full transition-all" style={{
                        width: `${c.avgRate}%`,
                        background: c.avgRate >= 80 ? '#16a34a' : c.avgRate >= 50 ? GOLD : '#dc2626',
                      }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
              <button
                onClick={() => setN8nDocsOpen((v) => !v)}
                className="w-full flex items-center justify-between text-sm font-semibold text-gray-700"
              >
                Send worksheets from n8n
                <span className="text-gray-300 text-[10px]">{n8nDocsOpen ? '▲' : '▼'}</span>
              </button>
              {n8nDocsOpen && (
                <div className="mt-2">
                  <p className="text-xs text-gray-500 mb-2">
                    POST to this endpoint with header <code className="bg-gray-100 px-1 rounded">x-api-key</code> to add a worksheet:
                  </p>
                  <div className="relative">
                    <pre className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 pr-16 text-xs overflow-x-auto text-gray-700 whitespace-pre-wrap">
                      {N8N_WEBHOOK_EXAMPLE}
                    </pre>
                    <button
                      onClick={async () => {
                        await navigator.clipboard.writeText(N8N_WEBHOOK_EXAMPLE)
                        setN8nCopied(true)
                        setTimeout(() => setN8nCopied(false), 1500)
                      }}
                      className="absolute top-2 right-2 text-[10px] font-semibold px-2 py-1 rounded-full transition"
                      style={{ background: 'rgba(200,134,10,0.12)', color: GOLD }}
                    >
                      {n8nCopied ? '✓ Copied' : 'Copy'}
                    </button>
                  </div>
                  <p className="text-[11px] text-gray-400 mt-2">
                    <code className="bg-gray-100 px-1 rounded">link</code>, <code className="bg-gray-100 px-1 rounded">portion</code> and <code className="bg-gray-100 px-1 rounded">folder</code> are only needed if students should be able to turn this worksheet in.
                  </p>
                </div>
              )}
            </div>

            <div className="bg-white rounded-xl shadow overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm table-fixed">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide" style={{ background: NAV, color: 'var(--faint)' }}>
                      <th className="px-3 sm:px-5 py-3 w-auto">Worksheet</th>
                      <th className="px-3 sm:px-5 py-3 w-32">Deadline</th>
                      <th className="px-3 sm:px-5 py-3 text-center w-32">Submissions</th>
                      <th className="px-3 sm:px-5 py-3 text-center w-40">Status</th>
                      <th className="px-3 sm:px-5 py-3 text-center w-20">Remove</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {filteredAssignments.map((a) => {
                      const p = analysisByAssignmentId[a.id]
                      const expanded = expandedAnalysisId === a.id
                      const rate = Number(a.submitted_pct)
                      const rateColor = rate >= 80 ? '#16a34a' : rate >= 50 ? GOLD : '#dc2626'
                      return (
                      <Fragment key={a.id}>
                      <tr className={a.completed ? 'opacity-60' : ''}>
                        <td className="px-3 sm:px-5 py-3 align-top">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium flex-shrink-0 ${a.subject === 'Science' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>
                              {a.subject}
                            </span>
                            <span className="font-medium text-gray-800 break-words">{a.title}</span>
                          </div>
                          {a.link && (
                            <a href={a.link} target="_blank" rel="noreferrer"
                              className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full mt-1.5 transition"
                              style={{ background: 'rgba(200,134,10,0.14)', color: GOLD, border: '1px solid rgba(200,134,10,0.35)' }}
                            >
                              📄 Worksheet ↗
                            </a>
                          )}
                          <p className="text-[10px] text-gray-300 mt-1.5">Created {formatIST(a.created_at)}</p>
                        </td>
                        <td className="px-3 sm:px-5 py-3 align-top whitespace-nowrap text-gray-700 text-xs">{formatIST(a.deadline)}</td>
                        <td className="px-3 sm:px-5 py-3 align-top text-center">
                          <button
                            onClick={() => setExpandedAnalysisId(expanded ? null : a.id)}
                            className="w-full text-center"
                          >
                            <div className="text-xs font-bold" style={{ color: rateColor }}>{a.submitted_count}/{a.total_students} · {rate}%</div>
                            {a.submitted_count > 0 && (
                              <div className="text-[10px] text-gray-400">{a.feedback_count}/{a.submitted_count} graded</div>
                            )}
                            <div className="text-gray-300 text-[10px]">{expanded ? '▲' : '▼'}</div>
                          </button>
                        </td>
                        <td className="px-3 sm:px-5 py-3 align-middle text-center">
                          <button
                            onClick={() => (a.submissions_closed ? setConfirmReopenAssignment(a) : toggleSubmissionsClosed(a))}
                            title={a.submissions_closed ? 'Requires a confirmation code to reopen' : 'Stop accepting new submissions, even before the deadline'}
                            className="text-xs font-bold px-3 py-2 rounded-lg shadow-sm transition hover:brightness-110 whitespace-nowrap"
                            style={a.submissions_closed
                              ? { background: '#dc2626', color: '#fff' }
                              : { background: GOLD, color: '#fff' }
                            }
                          >
                            {a.submissions_closed ? '🔒 Closed' : 'Close Submissions'}
                          </button>
                        </td>
                        <td className="px-3 sm:px-5 py-3 align-middle text-center">
                          <button
                            onClick={() => setConfirmDeleteAssignment(a)}
                            disabled={deletingAssignmentId === a.id}
                            className="text-xs font-bold text-red-500 hover:text-red-600 transition disabled:opacity-50"
                          >
                            {deletingAssignmentId === a.id ? '…' : 'Remove'}
                          </button>
                        </td>
                      </tr>
                      {expanded && p && (
                        <tr>
                          <td colSpan={5} className="px-3 sm:px-5 pb-4 pt-0 align-top bg-gray-50">
                            <div className="space-y-3 pt-1">
                              {p.missing.length === 0
                                ? <p className="text-xs text-green-600">Everyone submitted 🎉</p>
                                : (
                                  <div>
                                    <div className="flex items-center justify-between gap-2 mb-1.5 flex-wrap">
                                      <p className="text-xs text-gray-400">{p.missing.length} not submitted:</p>
                                      <button
                                        onClick={() => markAllSubmitted(p)}
                                        disabled={markingAllSubmittedId === a.id}
                                        className="text-xs font-semibold px-2.5 py-1 rounded-full transition disabled:opacity-50"
                                        style={{ background: 'rgba(34,197,94,0.12)', color: '#16a34a' }}
                                      >
                                        {markingAllSubmittedId === a.id ? 'Marking…' : `Mark All Submitted (${p.total}/${p.total})`}
                                      </button>
                                    </div>
                                    <div className="flex flex-wrap gap-1.5">
                                      {p.missing.map((s) => (
                                        <span
                                          key={s.student_id}
                                          className="text-xs px-2 py-0.5 rounded-full"
                                          style={{ background: 'rgba(239,68,68,0.12)', color: '#dc2626', border: '1px solid rgba(239,68,68,0.25)' }}
                                        >
                                          {s.student_name}
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                )}

                              {p.submittedWithFeedback.length > 0 && (
                                <div>
                                  <p className="text-xs text-gray-400 mb-1.5">
                                    Grading: {p.gradedCount}/{p.submittedWithFeedback.length} graded
                                  </p>
                                  <div className="space-y-2">
                                    {p.submittedWithFeedback.map(({ student, feedback }) => (
                                      <div key={student.student_id} className="text-xs border border-gray-100 rounded-lg px-2.5 py-2 bg-white">
                                        <div className="flex items-center justify-between gap-2">
                                          <span className="font-medium text-gray-700">{student.student_name}</span>
                                          <span className={feedback ? 'text-green-600 flex-shrink-0' : 'text-gray-400 flex-shrink-0'}>
                                            {feedback ? '✅ Graded' : '⏳ Pending grading'}
                                          </span>
                                        </div>
                                        {feedback && (feedback.handwriting_feedback || feedback.assignment_feedback) && (
                                          <div className="mt-1 space-y-1 text-gray-500">
                                            {feedback.handwriting_feedback && (
                                              <p><span className="font-semibold text-gray-600">✍️ Handwriting: </span>{stripFeedbackContext(feedback.handwriting_feedback)}</p>
                                            )}
                                            {feedback.assignment_feedback && (
                                              <p><span className="font-semibold text-gray-600">📝 Feedback: </span>{stripFeedbackContext(feedback.assignment_feedback)}</p>
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                      </Fragment>
                      )
                    })}
                  </tbody>
                </table>
                {filteredAssignments.length === 0 && (
                  <p className="text-center text-gray-400 py-10">No worksheets yet.</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Manage / Other tab ── */}
        {view === 'manage' && (
          <div className="space-y-4">
            {manageMode === 'list' ? (
              <div className="bg-white rounded-xl shadow overflow-hidden">
                {/* Header */}
                {(() => {
                  const filteredRoster = studentList
                    .filter((s) => classFilter === 'All' || String(s.class) === classFilter)
                    .filter((s) => !search || s.student_name.toLowerCase().includes(search.toLowerCase()))
                  return (
                    <>
                <div className="px-5 py-4 border-b flex items-center justify-between" style={{ background: NAV }}>
                  <div>
                    <p className="font-semibold text-gray-800">Student Roster</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {filteredRoster.length}{classFilter !== 'All' ? ` Class ${classFilter}` : ''} student{filteredRoster.length !== 1 ? 's' : ''} · expand a row to manage emails
                    </p>
                  </div>
                  <button
                    onClick={() => setManageMode('add')}
                    className="text-sm font-semibold px-4 py-2 rounded-lg text-white transition"
                    style={{ background: GOLD }}
                  >
                    + Add Student
                  </button>
                </div>

                {/* Column headers */}
                <div className="px-5 py-2 flex items-center gap-3 text-[10px] font-bold uppercase tracking-wider text-gray-400 border-b" style={{ background: NAV }}>
                  <span className="w-12 flex-shrink-0">Class</span>
                  <span className="flex-1">Student Name</span>
                  <span className="w-16 text-center flex-shrink-0">Emails</span>
                  <span className="w-16 flex-shrink-0" />
                </div>

                {/* Student list */}
                <div className="divide-y divide-gray-50">
                  {filteredRoster.map((s) => {
                    const isExpanded = expandedStudent === s.student_id
                    const isDeleting = deletingStudentId === s.student_id
                    return (
                      <div key={s.student_id}>
                        <div
                          className="px-5 py-3 flex items-center gap-3 cursor-pointer hover:bg-amber-50 transition"
                          onClick={() => { setExpandedStudent(isExpanded ? null : s.student_id); setPendingEmail('') }}
                        >
                          <span className="w-12 flex-shrink-0 text-center">
                            <span className="text-xs font-bold px-2.5 py-1 rounded-full text-white" style={{ background: GOLD }}>
                              {s.class}
                            </span>
                          </span>
                          <span className="flex-1 font-medium text-gray-800 truncate">{s.student_name}</span>
                          <span className="w-16 text-center text-xs text-gray-400 flex-shrink-0">{s.emails.length} email{s.emails.length !== 1 ? 's' : ''}</span>
                          <div className="flex items-center justify-end gap-2 flex-shrink-0">
                            {s.emails.some((e) => !e.login_created) && (
                              <button
                                onClick={(e) => { e.stopPropagation(); createStudentLogin(s) }}
                                disabled={creatingLoginId === s.student_id}
                                className="text-xs font-semibold px-2.5 py-1 rounded text-white transition disabled:opacity-50"
                                style={{ background: GOLD }}
                              >
                                {creatingLoginId === s.student_id ? 'Creating…' : 'Create Dashboard'}
                              </button>
                            )}
                            <button
                              onClick={(e) => { e.stopPropagation(); setConfirmDeleteStudent(s) }}
                              disabled={isDeleting}
                              className="text-xs text-red-500 font-medium px-2 py-1 rounded hover:bg-red-50 transition disabled:opacity-50"
                            >
                              {isDeleting ? '…' : 'Remove'}
                            </button>
                            <span className="text-gray-400 text-xs select-none">{isExpanded ? '▲' : '▼'}</span>
                          </div>
                        </div>

                        {isExpanded && (
                          <div className="px-5 pb-4 pt-2 border-t border-amber-100" style={{ background: 'rgba(200,134,10,0.06)' }}>
                            <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-2">Phone Number</p>
                            <div className="bg-white rounded-lg px-3 py-2 border border-gray-100 flex items-center justify-between gap-2 mb-3">
                              {editingPhoneStudentId === s.student_id ? (
                                <>
                                  <input
                                    type="tel"
                                    autoFocus
                                    placeholder="Phone number"
                                    value={editingPhoneValue}
                                    onChange={(e) => setEditingPhoneValue(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') updatePhone(s)
                                      if (e.key === 'Escape') { setEditingPhoneStudentId(null); setEditingPhoneValue('') }
                                    }}
                                    className="flex-1 border border-gray-200 rounded-lg px-2 py-1 text-sm focus:outline-none bg-white"
                                    onFocus={(e) => e.target.style.boxShadow = `0 0 0 2px ${GOLD}40`}
                                    onBlur={(e) => e.target.style.boxShadow = ''}
                                  />
                                  <button
                                    onClick={() => updatePhone(s)}
                                    disabled={savingPhone}
                                    className="text-xs font-semibold flex-shrink-0 disabled:opacity-50"
                                    style={{ color: GOLD }}
                                  >
                                    {savingPhone ? '…' : 'Save'}
                                  </button>
                                  <button
                                    onClick={() => { setEditingPhoneStudentId(null); setEditingPhoneValue('') }}
                                    className="text-xs text-gray-400 hover:text-gray-600 font-semibold flex-shrink-0"
                                  >
                                    Cancel
                                  </button>
                                </>
                              ) : (
                                <>
                                  <span className="text-sm text-gray-700 flex-1">{s.phone || '—'}</span>
                                  <button
                                    onClick={() => { setEditingPhoneStudentId(s.student_id); setEditingPhoneValue(s.phone || '') }}
                                    className="text-xs font-semibold hover:underline flex-shrink-0"
                                    style={{ color: GOLD }}
                                  >
                                    Edit
                                  </button>
                                </>
                              )}
                            </div>
                            <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-2">Linked Emails</p>
                            <div className="space-y-1.5 mb-3">
                              {s.emails.map((emailRow) => (
                                <div key={emailRow.id} className="bg-white rounded-lg px-3 py-2 border border-gray-100 space-y-1.5">
                                  <div className="flex items-center justify-between gap-2">
                                    {editingEmailId === emailRow.id ? (
                                      <>
                                        <input
                                          type="email"
                                          autoFocus
                                          value={editingEmailValue}
                                          onChange={(e) => setEditingEmailValue(e.target.value)}
                                          onKeyDown={(e) => {
                                            if (e.key === 'Enter') updateEmail(emailRow)
                                            if (e.key === 'Escape') { setEditingEmailId(null); setEditingEmailValue('') }
                                          }}
                                          className="flex-1 border border-gray-200 rounded-lg px-2 py-1 text-sm focus:outline-none bg-white"
                                          onFocus={(e) => e.target.style.boxShadow = `0 0 0 2px ${GOLD}40`}
                                          onBlur={(e) => e.target.style.boxShadow = ''}
                                        />
                                        <button
                                          onClick={() => updateEmail(emailRow)}
                                          disabled={savingEditEmail || !editingEmailValue.trim()}
                                          className="text-xs font-semibold flex-shrink-0 disabled:opacity-50"
                                          style={{ color: GOLD }}
                                        >
                                          {savingEditEmail ? '…' : 'Save'}
                                        </button>
                                        <button
                                          onClick={() => { setEditingEmailId(null); setEditingEmailValue('') }}
                                          className="text-xs text-gray-400 hover:text-gray-600 font-semibold flex-shrink-0"
                                        >
                                          Cancel
                                        </button>
                                      </>
                                    ) : (
                                      <>
                                        <span className="text-sm text-gray-700 flex items-center gap-1.5">
                                          {emailRow.email}
                                          {emailRow.login_created
                                            ? <span className="text-[10px] font-semibold text-green-600">✓ dashboard</span>
                                            : <span className="text-[10px] font-semibold text-gray-400">no dashboard</span>}
                                        </span>
                                        <div className="flex items-center gap-2 flex-shrink-0">
                                          <button
                                            onClick={() => { setEditingEmailId(emailRow.id); setEditingEmailValue(emailRow.email) }}
                                            className="text-xs font-semibold hover:underline"
                                            style={{ color: GOLD }}
                                          >
                                            Edit
                                          </button>
                                          {s.emails.length > 1 ? (
                                            <button
                                              onClick={() => removeEmail(emailRow)}
                                              disabled={deletingEmailId === emailRow.id}
                                              className="text-xs text-red-400 hover:text-red-600 font-semibold disabled:opacity-50"
                                            >
                                              {deletingEmailId === emailRow.id ? '…' : 'Remove'}
                                            </button>
                                          ) : (
                                            <span className="text-[10px] text-gray-300">primary</span>
                                          )}
                                        </div>
                                      </>
                                    )}
                                  </div>
                                  <div className="flex items-center justify-between gap-2 pt-1 border-t border-gray-50">
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 flex-shrink-0">ID</span>
                                    {editingSourceIdRow === emailRow.id ? (
                                      <>
                                        <input
                                          type="text"
                                          inputMode="numeric"
                                          autoFocus
                                          value={editingSourceIdValue}
                                          onChange={(e) => setEditingSourceIdValue(e.target.value)}
                                          onKeyDown={(e) => {
                                            if (e.key === 'Enter') updateSourceId(emailRow)
                                            if (e.key === 'Escape') { setEditingSourceIdRow(null); setEditingSourceIdValue('') }
                                          }}
                                          className="flex-1 border border-gray-200 rounded-lg px-2 py-1 text-sm focus:outline-none bg-white"
                                          onFocus={(e) => e.target.style.boxShadow = `0 0 0 2px ${GOLD}40`}
                                          onBlur={(e) => e.target.style.boxShadow = ''}
                                        />
                                        <button
                                          onClick={() => updateSourceId(emailRow)}
                                          disabled={savingSourceId}
                                          className="text-xs font-semibold flex-shrink-0 disabled:opacity-50"
                                          style={{ color: GOLD }}
                                        >
                                          {savingSourceId ? '…' : 'Save'}
                                        </button>
                                        <button
                                          onClick={() => { setEditingSourceIdRow(null); setEditingSourceIdValue('') }}
                                          className="text-xs text-gray-400 hover:text-gray-600 font-semibold flex-shrink-0"
                                        >
                                          Cancel
                                        </button>
                                      </>
                                    ) : (
                                      <>
                                        <span className="text-xs text-gray-500 flex-1">{emailRow.source_id ?? '—'}</span>
                                        <button
                                          onClick={() => { setEditingSourceIdRow(emailRow.id); setEditingSourceIdValue(emailRow.source_id != null ? String(emailRow.source_id) : '') }}
                                          className="text-xs font-semibold hover:underline flex-shrink-0"
                                          style={{ color: GOLD }}
                                        >
                                          Edit
                                        </button>
                                      </>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                            <div className="flex gap-2">
                              <input
                                type="email"
                                placeholder="Add another email…"
                                value={pendingEmail}
                                onChange={(e) => setPendingEmail(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') addEmailToStudent(s) }}
                                className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none bg-white"
                                onFocus={(e) => e.target.style.boxShadow = `0 0 0 2px ${GOLD}40`}
                                onBlur={(e) => e.target.style.boxShadow = ''}
                              />
                              <button
                                onClick={() => addEmailToStudent(s)}
                                disabled={savingEmail || !pendingEmail.trim()}
                                className="text-sm font-semibold px-3 py-1.5 rounded-lg text-white transition disabled:opacity-40"
                                style={{ background: GOLD }}
                              >
                                {savingEmail ? '…' : 'Add'}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                  {filteredRoster.length === 0 && (
                    <p className="text-center text-gray-400 py-10 text-sm">
                      {search ? 'No students match your search.' : classFilter !== 'All' ? `No Class ${classFilter} students.` : 'No students yet.'}
                    </p>
                  )}
                </div>
                    </>
                  )
                })()}
              </div>
            ) : (
              /* Add student form */
              <div className="bg-white rounded-xl shadow overflow-hidden max-w-xl">
                <div className="px-5 py-4 border-b" style={{ background: NAV }}>
                  <p className="font-semibold text-gray-800">Add New Student</p>
                </div>
                <div className="p-6 space-y-5">
                  {/* Name */}
                  <div>
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">Student Name</label>
                    <input
                      type="text"
                      placeholder="Full name"
                      value={newStudent.name}
                      onChange={(e) => setNewStudent((p) => ({ ...p, name: e.target.value }))}
                      className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm focus:outline-none"
                      onFocus={(e) => e.target.style.boxShadow = `0 0 0 2px ${GOLD}40`}
                      onBlur={(e) => e.target.style.boxShadow = ''}
                    />
                  </div>
                  {/* Class */}
                  <div>
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">Class *</label>
                    <div className="flex gap-2">
                      {['9', '10'].map((c) => (
                        <button
                          key={c}
                          onClick={() => setNewStudent((p) => ({ ...p, class: c }))}
                          className="px-8 py-2.5 rounded-lg text-sm font-semibold transition"
                          style={newStudent.class === c ? { background: GOLD, color: 'white' } : { background: 'rgba(200,134,10,0.1)', color: 'var(--text)' }}
                        >
                          Class {c}
                        </button>
                      ))}
                    </div>
                  </div>
                  {/* ID */}
                  <div>
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">ID *</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      placeholder="Roster ID"
                      value={newStudent.sourceId}
                      onChange={(e) => setNewStudent((p) => ({ ...p, sourceId: e.target.value }))}
                      className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm focus:outline-none"
                      onFocus={(e) => e.target.style.boxShadow = `0 0 0 2px ${GOLD}40`}
                      onBlur={(e) => e.target.style.boxShadow = ''}
                    />
                  </div>
                  {/* Phone */}
                  <div>
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">Phone Number</label>
                    <input
                      type="tel"
                      placeholder="Phone number"
                      value={newStudent.phone}
                      onChange={(e) => setNewStudent((p) => ({ ...p, phone: e.target.value }))}
                      className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm focus:outline-none"
                      onFocus={(e) => e.target.style.boxShadow = `0 0 0 2px ${GOLD}40`}
                      onBlur={(e) => e.target.style.boxShadow = ''}
                    />
                  </div>
                  {/* Emails */}
                  <div>
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">Email Addresses</label>
                    <div className="space-y-2">
                      {newStudent.emails.map((email, idx) => (
                        <div key={idx} className="flex gap-2">
                          <input
                            type="email"
                            placeholder={idx === 0 ? 'Primary email' : 'Additional email'}
                            value={email}
                            onChange={(e) => {
                              const emails = [...newStudent.emails]; emails[idx] = e.target.value
                              setNewStudent((p) => ({ ...p, emails }))
                            }}
                            className="flex-1 border border-gray-200 rounded-lg px-4 py-2.5 text-sm focus:outline-none"
                            onFocus={(e) => e.target.style.boxShadow = `0 0 0 2px ${GOLD}40`}
                            onBlur={(e) => e.target.style.boxShadow = ''}
                          />
                          {newStudent.emails.length > 1 && (
                            <button
                              onClick={() => setNewStudent((p) => ({ ...p, emails: p.emails.filter((_, i) => i !== idx) }))}
                              className="text-red-400 hover:text-red-600 px-2 text-lg"
                            >×</button>
                          )}
                        </div>
                      ))}
                      <button
                        onClick={() => setNewStudent((p) => ({ ...p, emails: [...p.emails, ''] }))}
                        className="text-sm font-medium"
                        style={{ color: GOLD }}
                      >
                        + Add another email
                      </button>
                    </div>
                  </div>
                  {/* Actions */}
                  <div className="flex gap-3 pt-1">
                    <button
                      onClick={addStudent}
                      disabled={savingStudent || !newStudent.name.trim() || !newStudent.class || !newStudent.sourceId.trim() || !newStudent.emails.some((e) => e.trim())}
                      className="px-6 py-2.5 rounded-lg text-sm font-semibold text-white transition disabled:opacity-50"
                      style={{ background: GOLD }}
                    >
                      {savingStudent ? 'Saving…' : 'Add Student'}
                    </button>
                    <button
                      onClick={() => { setManageMode('list'); setNewStudent({ name: '', class: '9', sourceId: '', phone: '', emails: [''] }) }}
                      className="px-6 py-2.5 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 transition"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
          </div>{/* /right-content */}
        </div>{/* /sidebar-layout */}
      </div>

      {selected && (
        <StudentDetailModal
          student={selected}
          scores={allScores.filter((r) => r.student_id === selected.student_id)}
          onClose={() => setSelected(null)}
        />
      )}

      {confirmDeleteStudent && (
        <ConfirmDeleteStudentModal
          student={confirmDeleteStudent}
          teacherEmail={session?.email}
          onCancel={() => setConfirmDeleteStudent(null)}
          onConfirm={() => deleteStudent(confirmDeleteStudent)}
        />
      )}

      {confirmDeleteAssignment && (
        <ConfirmDeleteAssignmentModal
          assignment={confirmDeleteAssignment}
          onCancel={() => setConfirmDeleteAssignment(null)}
          onConfirm={() => deleteAssignment(confirmDeleteAssignment.id)}
        />
      )}

      {confirmReopenAssignment && (
        <ConfirmReopenSubmissionsModal
          assignment={confirmReopenAssignment}
          teacherEmail={session?.email}
          onCancel={() => setConfirmReopenAssignment(null)}
          onConfirm={() => {
            toggleSubmissionsClosed(confirmReopenAssignment)
            setConfirmReopenAssignment(null)
          }}
        />
      )}

      {previewTest && (
        <SendReportPreviewModal
          test={previewTest}
          message={previewMessage}
          onMessageChange={setPreviewMessage}
          sending={sending === previewTest.key}
          onCancel={() => setPreviewTest(null)}
          onConfirm={async () => {
            await sendReport(previewTest, previewMessage)
            setPreviewTest(null)
          }}
        />
      )}

      {formatModalOpen && (
        <MessageFormatModal
          format={messageFormat}
          onCancel={() => setFormatModalOpen(false)}
          onSave={saveMessageFormat}
        />
      )}

      {editingTest && (
        <EditTestModal
          test={editingTest}
          saving={savingTestEdit}
          onCancel={() => setEditingTest(null)}
          onSave={(newTotalMarks, minPercent) => saveTestEdit(editingTest, newTotalMarks, minPercent)}
        />
      )}

      {deletingTest && (
        <ConfirmDeleteTestModal
          test={deletingTest}
          teacherEmail={session?.email}
          onCancel={() => setDeletingTest(null)}
          onConfirm={() => deleteTest(deletingTest)}
        />
      )}
    </div>
  )
}

function SendReportPreviewModal({ test, message, onMessageChange, sending, onCancel, onConfirm }) {
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={sending ? undefined : onCancel}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-bold text-gray-800 mb-1">Preview message — Test #{test.testNo}</h3>
        <p className="text-sm text-gray-500 mb-4">
          Edit as needed — exactly what's in the box below will be posted to the Class {test.class} group.
        </p>
        <textarea
          value={message}
          onChange={(e) => onMessageChange(e.target.value)}
          disabled={sending}
          rows={12}
          className="w-full bg-gray-50 border border-gray-200 rounded-lg p-4 max-h-80 overflow-y-auto whitespace-pre-wrap text-sm text-gray-800 font-mono mb-4 focus:outline-none focus:ring-2 focus:ring-amber-200 disabled:opacity-60"
        />
        <div className="flex gap-2 justify-end">
          <button
            onClick={onCancel}
            disabled={sending}
            className="text-sm font-medium px-4 py-2 rounded-lg text-gray-600 hover:bg-gray-100 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={sending || !message.trim()}
            className="text-sm font-semibold px-4 py-2 rounded-lg text-white transition disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: GOLD }}
          >
            {sending ? 'Sending…' : '📤 Confirm & Send'}
          </button>
        </div>
      </div>
    </div>
  )
}

function MessageFormatModal({ format, onCancel, onSave }) {
  const [text, setText] = useState(format)

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onCancel}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-bold text-gray-800 mb-1">Message Format</h3>
        <p className="text-sm text-gray-500 mb-3">
          Customize the template used to generate the top-scorer message. Use these placeholders anywhere in the text:
        </p>
        <div className="flex flex-wrap gap-1.5 mb-3">
          {MESSAGE_FORMAT_PLACEHOLDERS.map((p) => (
            <span
              key={p.key}
              title={p.label}
              className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-amber-50 border border-amber-200"
              style={{ color: GOLD }}
            >
              {`{${p.key}}`}
            </span>
          ))}
        </div>
        <textarea
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={14}
          className="w-full bg-gray-50 border border-gray-200 rounded-lg p-4 whitespace-pre-wrap text-sm text-gray-800 font-mono mb-4 focus:outline-none focus:ring-2 focus:ring-amber-200"
        />
        <div className="flex gap-2 justify-between">
          <button
            onClick={() => setText(DEFAULT_MESSAGE_FORMAT)}
            className="text-sm font-medium px-4 py-2 rounded-lg text-gray-600 hover:bg-gray-100 transition"
          >
            Reset to default
          </button>
          <div className="flex gap-2">
            <button
              onClick={onCancel}
              className="text-sm font-medium px-4 py-2 rounded-lg text-gray-600 hover:bg-gray-100 transition"
            >
              Cancel
            </button>
            <button
              onClick={() => onSave(text)}
              disabled={!text.trim()}
              className="text-sm font-semibold px-4 py-2 rounded-lg text-white transition disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: GOLD }}
            >
              Save Format
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function EditTestModal({ test, saving, onCancel, onSave }) {
  const [totalMarks, setTotalMarks] = useState(String(test.total_marks))
  const [minPercent, setMinPercent] = useState('0')

  const totalNum = Number(totalMarks)
  const minNum = Number(minPercent)
  const validTotal = Number.isFinite(totalNum) && totalNum > 0
  const validMin = Number.isFinite(minNum) && minNum >= 0 && minNum <= 100
  const floor = validTotal && validMin ? Math.round((minNum / 100) * totalNum) : null
  const affected = floor !== null
    ? test.scores.filter((s) => {
        if (s.is_absent) return false
        const rescaled = Math.round((s.score_obtained / test.total_marks) * totalNum)
        return rescaled < floor
      }).length
    : 0

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={saving ? undefined : onCancel}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-bold text-gray-800 mb-1">Edit Test #{test.testNo}</h3>
        <p className="text-sm text-gray-500 mb-4">{test.subject} · {test.topic} · Class {test.class}</p>

        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Total Marks</label>
        <input
          autoFocus
          type="number"
          min="1"
          value={totalMarks}
          onChange={(e) => setTotalMarks(e.target.value)}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-1 focus:outline-none focus:ring-2 focus:ring-amber-200"
        />
        {validTotal && totalNum !== test.total_marks && (
          <p className="text-xs text-gray-400 mb-4">
            All obtained scores will be rescaled proportionally to keep each student&apos;s percentage the same (e.g. {test.total_marks} → {totalNum}).
          </p>
        )}
        {(!validTotal || totalNum === test.total_marks) && <div className="mb-4" />}

        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Minimum Score (%)</label>
        <input
          type="number"
          min="0"
          max="100"
          value={minPercent}
          onChange={(e) => setMinPercent(e.target.value)}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-1 focus:outline-none focus:ring-2 focus:ring-amber-200"
        />
        <p className="text-xs text-gray-400 mb-4">
          {floor !== null
            ? floor > 0
              ? `Anyone scoring below ${floor}/${totalNum} will be raised to ${floor}${affected ? ` — affects ${affected} student${affected === 1 ? '' : 's'}.` : '.'}`
              : 'No floor will be applied — scores are left as-is.'
            : 'Enter valid values above.'}
        </p>

        <div className="flex gap-2 justify-end">
          <button
            onClick={onCancel}
            disabled={saving}
            className="text-sm font-medium px-4 py-2 rounded-lg text-gray-600 hover:bg-gray-100 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
          <button
            onClick={() => onSave(totalNum, minNum)}
            disabled={saving || !validTotal || !validMin}
            className="text-sm font-semibold px-4 py-2 rounded-lg text-white transition disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: GOLD }}
          >
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  )
}

const DELETE_OTP_PURPOSE = 'delete-student'
const OTP_RESEND_COOLDOWN = 45 // seconds, must match send-action-otp's cooldown

function ConfirmDeleteStudentModal({ student, teacherEmail, onCancel, onConfirm }) {
  const PHRASE = 'delete this user'
  const [text, setText] = useState('')
  const [step, setStep] = useState('confirm') // confirm | otp
  const [code, setCode] = useState('')
  const [sending, setSending] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [error, setError] = useState('')
  const [cooldown, setCooldown] = useState(0)
  const cooldownRef = useRef(null)
  const matches = text.trim().toLowerCase() === PHRASE

  useEffect(() => () => clearInterval(cooldownRef.current), [])

  function startCooldown() {
    setCooldown(OTP_RESEND_COOLDOWN)
    clearInterval(cooldownRef.current)
    cooldownRef.current = setInterval(() => {
      setCooldown((c) => {
        if (c <= 1) { clearInterval(cooldownRef.current); return 0 }
        return c - 1
      })
    }, 1000)
  }

  async function sendCode() {
    setError('')
    setSending(true)
    const { data, error: fnErr } = await supabase.functions.invoke('send-action-otp', {
      body: { purpose: DELETE_OTP_PURPOSE },
    })
    setSending(false)
    if (fnErr || data?.ok === false) {
      setError(data?.error || 'Could not send code. Please try again.')
      return
    }
    startCooldown()
    setStep('otp')
  }

  async function verifyAndConfirm() {
    setError('')
    setVerifying(true)
    const { data, error: fnErr } = await supabase.functions.invoke('verify-action-otp', {
      body: { code: code.trim(), purpose: DELETE_OTP_PURPOSE },
    })
    setVerifying(false)
    if (fnErr || data?.ok === false) {
      setError(data?.error || 'Invalid or expired code.')
      return
    }
    onConfirm()
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onCancel}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-bold text-gray-800 mb-1">Remove {student.student_name}?</h3>
        <p className="text-sm text-gray-500 mb-4">
          This permanently deletes this student's login email(s) and all of their score reports from Supabase. This cannot be undone.
        </p>

        {step === 'confirm' ? (
          <>
            <p className="text-xs text-gray-500 mb-2">
              Type <span className="font-mono font-semibold text-gray-700">{PHRASE}</span> to confirm:
            </p>
            <input
              autoFocus
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && matches) sendCode() }}
              placeholder={PHRASE}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-red-200"
            />
            {error && (
              <div className="rounded-lg px-3 py-2 text-xs mb-4 bg-red-50 border border-red-200 text-red-600">{error}</div>
            )}
            <div className="flex gap-2 justify-end">
              <button
                onClick={onCancel}
                className="text-sm font-medium px-4 py-2 rounded-lg text-gray-600 hover:bg-gray-100 transition"
              >
                Cancel
              </button>
              <button
                onClick={sendCode}
                disabled={!matches || sending}
                className="text-sm font-semibold px-4 py-2 rounded-lg text-white bg-red-500 hover:bg-red-600 transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {sending ? 'Sending code…' : 'Send Confirmation Code'}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-xs text-gray-500 mb-2">
              Enter the 6-digit code sent to <span className="font-medium text-gray-700">{teacherEmail}</span> to permanently delete this student:
            </p>
            <input
              autoFocus
              type="text"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              onKeyDown={(e) => { if (e.key === 'Enter' && code.length === 6) verifyAndConfirm() }}
              placeholder="123456"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-2 tracking-[0.3em] text-center focus:outline-none focus:ring-2 focus:ring-red-200"
            />
            <button
              type="button"
              disabled={cooldown > 0 || sending}
              onClick={sendCode}
              className="text-xs font-medium mb-4 disabled:text-gray-400 text-red-600"
            >
              {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
            </button>
            {error && (
              <div className="rounded-lg px-3 py-2 text-xs mb-4 bg-red-50 border border-red-200 text-red-600">{error}</div>
            )}
            <div className="flex gap-2 justify-end">
              <button
                onClick={onCancel}
                className="text-sm font-medium px-4 py-2 rounded-lg text-gray-600 hover:bg-gray-100 transition"
              >
                Cancel
              </button>
              <button
                onClick={verifyAndConfirm}
                disabled={code.length !== 6 || verifying}
                className="text-sm font-semibold px-4 py-2 rounded-lg text-white bg-red-500 hover:bg-red-600 transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {verifying ? 'Verifying…' : 'Delete Student'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function ConfirmDeleteAssignmentModal({ assignment, onCancel, onConfirm }) {
  const [deleting, setDeleting] = useState(false)

  async function handleConfirm() {
    setDeleting(true)
    await onConfirm()
    setDeleting(false)
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onCancel}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-bold text-gray-800 mb-1">Remove "{assignment.title}"?</h3>
        <p className="text-sm text-gray-500 mb-4">
          This permanently removes the worksheet and its link for every student in Class {assignment.class}, including everyone's submissions for it. This cannot be undone.
        </p>

        <div className="flex gap-2 justify-end">
          <button
            onClick={onCancel}
            className="text-sm font-medium px-4 py-2 rounded-lg text-gray-600 hover:bg-gray-100 transition"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={deleting}
            className="text-sm font-semibold px-4 py-2 rounded-lg text-white bg-red-500 hover:bg-red-600 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {deleting ? 'Removing…' : 'Remove Worksheet'}
          </button>
        </div>
      </div>
    </div>
  )
}

const REOPEN_SUBMISSIONS_OTP_PURPOSE = 'reopen-worksheet-submissions'

function ConfirmReopenSubmissionsModal({ assignment, teacherEmail, onCancel, onConfirm }) {
  const [step, setStep] = useState('confirm') // confirm | otp
  const [code, setCode] = useState('')
  const [sending, setSending] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [error, setError] = useState('')
  const [cooldown, setCooldown] = useState(0)
  const cooldownRef = useRef(null)

  useEffect(() => () => clearInterval(cooldownRef.current), [])

  function startCooldown() {
    setCooldown(OTP_RESEND_COOLDOWN)
    clearInterval(cooldownRef.current)
    cooldownRef.current = setInterval(() => {
      setCooldown((c) => {
        if (c <= 1) { clearInterval(cooldownRef.current); return 0 }
        return c - 1
      })
    }, 1000)
  }

  async function sendCode() {
    setError('')
    setSending(true)
    const { data, error: fnErr } = await supabase.functions.invoke('send-action-otp', {
      body: { purpose: REOPEN_SUBMISSIONS_OTP_PURPOSE },
    })
    setSending(false)
    if (fnErr || data?.ok === false) {
      setError(data?.error || 'Could not send code. Please try again.')
      return
    }
    startCooldown()
    setStep('otp')
  }

  async function verifyAndConfirm() {
    setError('')
    setVerifying(true)
    const { data, error: fnErr } = await supabase.functions.invoke('verify-action-otp', {
      body: { code: code.trim(), purpose: REOPEN_SUBMISSIONS_OTP_PURPOSE },
    })
    setVerifying(false)
    if (fnErr || data?.ok === false) {
      setError(data?.error || 'Invalid or expired code.')
      return
    }
    onConfirm()
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onCancel}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-bold text-gray-800 mb-1">Reopen "{assignment.title}"?</h3>
        <p className="text-sm text-gray-500 mb-4">
          This lets Class {assignment.class} students submit this worksheet again. A code is required since submissions were deliberately closed.
        </p>

        {step === 'confirm' ? (
          <>
            {error && (
              <div className="rounded-lg px-3 py-2 text-xs mb-4 bg-red-50 border border-red-200 text-red-600">{error}</div>
            )}
            <div className="flex gap-2 justify-end">
              <button
                onClick={onCancel}
                className="text-sm font-medium px-4 py-2 rounded-lg text-gray-600 hover:bg-gray-100 transition"
              >
                Cancel
              </button>
              <button
                onClick={sendCode}
                disabled={sending}
                className="text-sm font-semibold px-4 py-2 rounded-lg text-white transition disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ background: GOLD }}
              >
                {sending ? 'Sending code…' : 'Send Confirmation Code'}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-xs text-gray-500 mb-2">
              Enter the 6-digit code sent to <span className="font-medium text-gray-700">{teacherEmail}</span> to reopen submissions:
            </p>
            <input
              autoFocus
              type="text"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              onKeyDown={(e) => { if (e.key === 'Enter' && code.length === 6) verifyAndConfirm() }}
              placeholder="123456"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-2 tracking-[0.3em] text-center focus:outline-none focus:ring-2 focus:ring-orange-200"
            />
            <button
              type="button"
              disabled={cooldown > 0 || sending}
              onClick={sendCode}
              className="text-xs font-medium mb-4 disabled:text-gray-400"
              style={{ color: cooldown > 0 ? undefined : GOLD }}
            >
              {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
            </button>
            {error && (
              <div className="rounded-lg px-3 py-2 text-xs mb-4 bg-red-50 border border-red-200 text-red-600">{error}</div>
            )}
            <div className="flex gap-2 justify-end">
              <button
                onClick={onCancel}
                className="text-sm font-medium px-4 py-2 rounded-lg text-gray-600 hover:bg-gray-100 transition"
              >
                Cancel
              </button>
              <button
                onClick={verifyAndConfirm}
                disabled={code.length !== 6 || verifying}
                className="text-sm font-semibold px-4 py-2 rounded-lg text-white transition disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ background: GOLD }}
              >
                {verifying ? 'Verifying…' : 'Reopen Submissions'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

const DELETE_TEST_OTP_PURPOSE = 'delete-test'

function ConfirmDeleteTestModal({ test, teacherEmail, onCancel, onConfirm }) {
  const [step, setStep] = useState('confirm') // confirm | otp
  const [code, setCode] = useState('')
  const [sending, setSending] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [error, setError] = useState('')
  const [cooldown, setCooldown] = useState(0)
  const cooldownRef = useRef(null)

  useEffect(() => () => clearInterval(cooldownRef.current), [])

  function startCooldown() {
    setCooldown(OTP_RESEND_COOLDOWN)
    clearInterval(cooldownRef.current)
    cooldownRef.current = setInterval(() => {
      setCooldown((c) => {
        if (c <= 1) { clearInterval(cooldownRef.current); return 0 }
        return c - 1
      })
    }, 1000)
  }

  async function sendCode() {
    setError('')
    setSending(true)
    const { data, error: fnErr } = await supabase.functions.invoke('send-action-otp', {
      body: { purpose: DELETE_TEST_OTP_PURPOSE },
    })
    setSending(false)
    if (fnErr || data?.ok === false) {
      setError(data?.error || 'Could not send code. Please try again.')
      return
    }
    startCooldown()
    setStep('otp')
  }

  async function verifyAndConfirm() {
    setError('')
    setVerifying(true)
    const { data, error: fnErr } = await supabase.functions.invoke('verify-action-otp', {
      body: { code: code.trim(), purpose: DELETE_TEST_OTP_PURPOSE },
    })
    setVerifying(false)
    if (fnErr || data?.ok === false) {
      setError(data?.error || 'Invalid or expired code.')
      return
    }
    onConfirm()
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onCancel}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-bold text-gray-800 mb-1">Delete Test #{test.testNo}?</h3>
        <p className="text-sm text-gray-500 mb-4">
          This permanently deletes {test.subject} · {test.topic} · Class {test.class} and every student's score for it, from the student dashboard, teacher dashboard, and Supabase. This cannot be undone.
        </p>

        {step === 'confirm' ? (
          <>
            {error && (
              <div className="rounded-lg px-3 py-2 text-xs mb-4 bg-red-50 border border-red-200 text-red-600">{error}</div>
            )}
            <div className="flex gap-2 justify-end">
              <button
                onClick={onCancel}
                className="text-sm font-medium px-4 py-2 rounded-lg text-gray-600 hover:bg-gray-100 transition"
              >
                Cancel
              </button>
              <button
                onClick={sendCode}
                disabled={sending}
                className="text-sm font-semibold px-4 py-2 rounded-lg text-white bg-red-500 hover:bg-red-600 transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {sending ? 'Sending code…' : 'Send Confirmation Code'}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-xs text-gray-500 mb-2">
              Enter the 6-digit code sent to <span className="font-medium text-gray-700">{teacherEmail}</span> to permanently delete this test:
            </p>
            <input
              autoFocus
              type="text"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              onKeyDown={(e) => { if (e.key === 'Enter' && code.length === 6) verifyAndConfirm() }}
              placeholder="123456"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-2 tracking-[0.3em] text-center focus:outline-none focus:ring-2 focus:ring-red-200"
            />
            <button
              type="button"
              disabled={cooldown > 0 || sending}
              onClick={sendCode}
              className="text-xs font-medium mb-4 disabled:text-gray-400 text-red-600"
            >
              {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
            </button>
            {error && (
              <div className="rounded-lg px-3 py-2 text-xs mb-4 bg-red-50 border border-red-200 text-red-600">{error}</div>
            )}
            <div className="flex gap-2 justify-end">
              <button
                onClick={onCancel}
                className="text-sm font-medium px-4 py-2 rounded-lg text-gray-600 hover:bg-gray-100 transition"
              >
                Cancel
              </button>
              <button
                onClick={verifyAndConfirm}
                disabled={code.length !== 6 || verifying}
                className="text-sm font-semibold px-4 py-2 rounded-lg text-white bg-red-500 hover:bg-red-600 transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {verifying ? 'Verifying…' : 'Delete Test'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function PctBadge({ pct }) {
  if (pct === null) return <span className="text-gray-300 text-xs">—</span>
  const n = Number(pct)
  const color = n >= 80 ? '#16a34a' : n >= 60 ? '#c8860a' : '#ef4444'
  return <span className="font-semibold" style={{ color }}>{pct}%</span>
}

function StatCard({ label, value, type }) {
  const styles = {
    gold:   { accent: '#c8860a',  valueColor: '#1e293b' },
    green:  { accent: '#22c55e',  valueColor: '#1e293b' },
    brown:  { accent: '#f59e0b',  valueColor: '#1e293b' },
    brown2: { accent: '#a78bfa',  valueColor: '#1e293b' },
  }
  const s = styles[type]
  return (
    <div className="bg-white rounded-xl overflow-hidden shadow-sm border border-gray-100">
      <div className="h-1 w-full" style={{ background: s.accent }} />
      <div className="px-5 py-4">
        <p className="text-[11px] font-semibold uppercase tracking-wider mb-2 text-gray-400">{label}</p>
        <p className="text-3xl font-bold tracking-tight text-gray-800">{value}</p>
      </div>
    </div>
  )
}

function StudentDetailModal({ student, scores, onClose }) {
  const [tab, setTab] = useState('all')
  const [subjectFilter, setSubjectFilter] = useState('All')
  const [sortBy, setSortBy] = useState('date-desc')

  const appeared = scores.filter((s) => !s.is_absent)
  const displayed = useMemo(() => {
    let rows = subjectFilter === 'All' ? [...scores] : scores.filter((s) => s.subject === subjectFilter)
    if (sortBy === 'date-asc')  rows.sort((a, b) => a.date.localeCompare(b.date))
    if (sortBy === 'date-desc') rows.sort((a, b) => b.date.localeCompare(a.date))
    if (sortBy === 'pct-asc')   rows.sort((a, b) => (a.is_absent ? -1 : a.score_obtained / a.total_marks) - (b.is_absent ? -1 : b.score_obtained / b.total_marks))
    if (sortBy === 'pct-desc')  rows.sort((a, b) => (b.is_absent ? -1 : b.score_obtained / b.total_marks) - (a.is_absent ? -1 : a.score_obtained / a.total_marks))
    if (sortBy === 'subject')   rows.sort((a, b) => a.subject.localeCompare(b.subject))
    return rows
  }, [scores, subjectFilter, sortBy])

  const chartData = appeared
    .slice().sort((a, b) => a.date.localeCompare(b.date))
    .map((s) => ({ date: s.date.slice(5), pct: +((s.score_obtained / s.total_marks) * 100).toFixed(1) }))

  const sciRows  = appeared.filter((s) => s.subject === 'Science')
  const mathRows = appeared.filter((s) => s.subject === 'Maths')
  const subjectData = [
    { subject: 'Science', avg: sciRows.length  ? +(sciRows.reduce((a, s)  => a + (s.score_obtained / s.total_marks) * 100, 0) / sciRows.length).toFixed(1)  : 0 },
    { subject: 'Maths',   avg: mathRows.length ? +(mathRows.reduce((a, s) => a + (s.score_obtained / s.total_marks) * 100, 0) / mathRows.length).toFixed(1) : 0 },
  ]

  // Delta per score vs previous test (by date order)
  const deltaMap = useMemo(() => {
    const sorted = [...appeared].sort((a, b) => a.date.localeCompare(b.date))
    const map = {}
    sorted.forEach((s, i) => {
      if (i === 0) { map[s.id] = null; return }
      const prev = (sorted[i - 1].score_obtained / sorted[i - 1].total_marks) * 100
      const curr = (s.score_obtained / s.total_marks) * 100
      map[s.id] = +(curr - prev).toFixed(1)
    })
    return map
  }, [appeared])

  const topicMap = {}
  appeared.forEach((s) => {
    const key = s.topic_name
    if (!topicMap[key]) topicMap[key] = { topic: key, subject: s.subject, total: 0, count: 0, best: 0, worst: 100 }
    const pct = (s.score_obtained / s.total_marks) * 100
    topicMap[key].total += pct
    topicMap[key].count += 1
    topicMap[key].best   = Math.max(topicMap[key].best, pct)
    topicMap[key].worst  = Math.min(topicMap[key].worst, pct)
  })
  const topicStats    = Object.values(topicMap).map((t) => ({ ...t, avg: +(t.total / t.count).toFixed(1), best: +t.best.toFixed(1), worst: +t.worst.toFixed(1) }))
  const strongTopics  = topicStats.filter((t) => t.avg >= 80).sort((a, b) => b.avg - a.avg)
  const moderateTopics = topicStats.filter((t) => t.avg >= 60 && t.avg < 80).sort((a, b) => b.avg - a.avg)
  const weakTopics    = topicStats.filter((t) => t.avg < 60).sort((a, b) => a.avg - b.avg)

  const sciTopics  = topicStats.filter((t) => t.subject === 'Science').sort((a, b) => b.avg - a.avg)
  const mathTopics = topicStats.filter((t) => t.subject === 'Maths').sort((a, b) => b.avg - a.avg)

  const totalScored = appeared.reduce((sum, s) => sum + s.score_obtained, 0)
  const totalMarks  = appeared.reduce((sum, s) => sum + s.total_marks, 0)
  const totalLost   = totalMarks - totalScored

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center sm:p-4" onClick={onClose}>
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-4xl max-h-[92vh] sm:max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between z-10">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-bold text-gray-800">{student.student_name}</h2>
            <span className="px-2 py-0.5 rounded-full text-xs font-bold text-white" style={{ background: GOLD }}>Class {student.class}</span>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
        </div>

        <div className="p-6 space-y-5">
          {/* Mini stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
            <MiniStat label="Tests Taken"  value={`${student.appeared}/${student.totalTests}`} />
            <MiniStat label="Overall Avg"  value={student.avgPct ? `${student.avgPct}%` : '—'} />
            <MiniStat label="Science Avg"  value={student.sciAvg  ? `${student.sciAvg}%`  : '—'} />
            <MiniStat label="Maths Avg"    value={student.mathAvg ? `${student.mathAvg}%` : '—'} />
            <MiniStat label="+ve Score"    value={appeared.length ? totalScored : '—'} positive />
            <MiniStat label="-ve Score"    value={appeared.length ? totalLost   : '—'} negative />
            <MiniStat label="Class Rank"   value={student.rank ? `#${student.rank}` : '—'} highlight />
          </div>

          {/* Charts */}
          <div className="grid md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
              <p className="text-xs text-gray-500 font-medium mb-2">Score Trend (%)</p>
              <ResponsiveContainer width="100%" height={160}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(200,134,10,0.12)" />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--faint)' }} minTickGap={48} interval="preserveStartEnd" />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: 'var(--faint)' }} unit="%" />
                  <ReferenceLine y={80} stroke="#16a34a" strokeDasharray="4 3" strokeWidth={1.5}
                    label={{ value: '80%', position: 'insideTopRight', fontSize: 9, fill: '#16a34a' }} />
                  <Tooltip formatter={(v) => `${v}%`} />
                  <Line type="monotone" dataKey="pct" stroke={GOLD} strokeWidth={2}
                    dot={(props) => {
                      const { cx, cy, payload } = props
                      const color = payload.pct >= 80 ? '#16a34a' : '#ef4444'
                      return <circle key={`dot-${cx}-${cy}`} cx={cx} cy={cy} r={3} fill={color} stroke="white" strokeWidth={1} />
                    }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div>
              <p className="text-xs text-gray-500 font-medium mb-2">Subject Average</p>
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={subjectData} barSize={28}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(200,134,10,0.12)" />
                  <XAxis dataKey="subject" tick={{ fontSize: 11, fill: 'var(--faint)' }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: 'var(--faint)' }} unit="%" />
                  <Tooltip formatter={(v) => `${v}%`} />
                  <Bar dataKey="avg" fill={GOLD} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Tabs */}
          <div className="border border-gray-100 rounded-xl overflow-hidden">
            <div className="flex border-b border-gray-100 overflow-x-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
              {[
                { key: 'all',      label: '📋 All Tests',       count: scores.length },
                { key: 'charts',   label: '📊 By Chapter',      count: topicStats.length },
                { key: 'strong',   label: '🏆 Strong (≥80%)',  count: strongTopics.length },
                { key: 'moderate', label: '🟡 Moderate (60–79%)', count: moderateTopics.length },
                { key: 'weak',     label: '⚠️ Weak (<60%)',    count: weakTopics.length },
              ].map(({ key, label, count }) => (
                <button key={key} onClick={() => setTab(key)}
                  className={`flex items-center gap-1.5 px-3 sm:px-4 py-2.5 text-xs font-medium transition border-b-2 -mb-px whitespace-nowrap flex-shrink-0 ${tab === key ? '' : 'text-gray-500'}`}
                  style={tab === key ? { borderColor: GOLD, color: GOLD } : { borderColor: 'transparent' }}
                >
                  {label}
                  <span className={`rounded-full px-1.5 py-0.5 font-bold text-[10px] ${tab === key ? 'text-white' : 'bg-gray-100 text-gray-500'}`}
                    style={tab === key ? { background: GOLD } : {}}>
                    {count}
                  </span>
                </button>
              ))}
            </div>

            {/* All Tests */}
            {tab === 'all' && (
              <>
                {/* Filter + Sort bar */}
                <div className="px-4 py-2.5 flex flex-wrap items-center gap-2 border-b border-gray-100" style={{ background: 'rgba(200,134,10,0.06)' }}>
                  <div className="flex gap-1">
                    {['All', 'Science', 'Maths'].map((f) => (
                      <button key={f} onClick={() => setSubjectFilter(f)}
                        className="px-2.5 py-1 rounded-full text-xs font-semibold transition"
                        style={subjectFilter === f
                          ? { background: GOLD, color: 'white' }
                          : { background: 'rgba(200,134,10,0.12)', color: 'var(--faint)', border: '1px solid rgba(200,134,10,0.25)' }}
                      >{f}</button>
                    ))}
                  </div>
                  <div className="w-px h-4 bg-gray-300" />
                  <div className="flex items-center gap-1 flex-wrap">
                    <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Sort:</span>
                    {[
                      { key: 'date-desc', label: 'Date ↓' },
                      { key: 'date-asc',  label: 'Date ↑' },
                      { key: 'pct-desc',  label: '% ↓' },
                      { key: 'pct-asc',   label: '% ↑' },
                      { key: 'subject',   label: 'Subject' },
                    ].map(({ key, label }) => (
                      <button key={key} onClick={() => setSortBy(key)}
                        className="px-2.5 py-1 rounded text-[10px] font-semibold transition"
                        style={sortBy === key
                          ? { background: 'rgba(200,134,10,0.22)', color: GOLD, border: '1px solid rgba(200,134,10,0.4)' }
                          : { background: 'rgba(200,134,10,0.06)', color: 'var(--faint)', border: '1px solid rgba(200,134,10,0.2)' }}
                      >{label}</button>
                    ))}
                  </div>
                  <span className="ml-auto text-[10px] text-gray-400">{displayed.length} tests</span>
                </div>

                {/* Scrollable table */}
                <div className="table-scroll" style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: '360px' }}>
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 z-10">
                        <tr className="text-xs text-gray-500 uppercase tracking-wide" style={{ background: 'rgba(200,134,10,0.1)', borderBottom: '2px solid rgba(200,134,10,0.25)' }}>
                          <th className="px-4 py-2.5 text-left cursor-pointer hover:text-amber-700 select-none font-semibold"
                            onClick={() => setSortBy(sortBy === 'date-desc' ? 'date-asc' : 'date-desc')}>
                            Date {sortBy === 'date-desc' ? '↓' : sortBy === 'date-asc' ? '↑' : ''}
                          </th>
                          <th className="px-4 py-2.5 text-left cursor-pointer hover:text-amber-700 select-none font-semibold"
                            onClick={() => setSortBy('subject')}>
                            Subject {sortBy === 'subject' ? '↓' : ''}
                          </th>
                          <th className="px-4 py-2.5 text-left font-semibold">Topic</th>
                          <th className="px-4 py-2.5 text-center font-semibold">Score</th>
                          <th className="px-4 py-2.5 text-center font-semibold">Total</th>
                          <th className="px-4 py-2.5 text-center cursor-pointer hover:text-amber-700 select-none font-semibold"
                            onClick={() => setSortBy(sortBy === 'pct-desc' ? 'pct-asc' : 'pct-desc')}>
                            % {sortBy === 'pct-desc' ? '↓' : sortBy === 'pct-asc' ? '↑' : ''}
                          </th>
                          <th className="px-4 py-2.5 text-center hidden sm:table-cell font-semibold">Δ</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-amber-100">
                        {displayed.map((s) => {
                          const pct   = s.is_absent ? null : +((s.score_obtained / s.total_marks) * 100).toFixed(1)
                          const delta = s.is_absent ? null : deltaMap[s.id]
                          return (
                            <tr key={s.id} className="bg-white hover:bg-amber-50 transition-colors">
                              <td className="px-4 py-2.5 text-gray-500 text-xs">{s.date}</td>
                              <td className="px-4 py-2.5">
                                <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${s.subject === 'Science' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>{s.subject}</span>
                              </td>
                              <td className="px-4 py-2.5 text-gray-700 max-w-[180px] truncate text-xs font-medium">{s.topic_name}</td>
                              <td className="px-4 py-2.5 text-center font-semibold text-gray-800 text-sm">
                                {s.is_absent ? <span className="text-red-400 text-xs font-medium">Absent</span> : s.score_obtained}
                              </td>
                              <td className="px-4 py-2.5 text-center text-gray-500 text-sm">{s.total_marks}</td>
                              <td className="px-4 py-2.5 text-center">
                                {pct !== null
                                  ? <span className={`font-bold text-sm ${pct >= 80 ? 'text-green-600' : pct >= 60 ? 'text-amber-600' : 'text-red-500'}`}>{pct}%</span>
                                  : <span className="text-gray-300">—</span>}
                              </td>
                              <td className="px-4 py-2.5 text-center hidden sm:table-cell">
                                <DeltaBadge delta={delta} />
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                </div>
              </>
            )}

            {/* Charts tab */}
            {tab === 'charts' && (
              <div className="p-4 space-y-6">
                {topicStats.length === 0
                  ? <p className="text-sm text-gray-400 py-4 text-center">No chapter data yet.</p>
                  : <>
                      <div className="flex flex-wrap items-center gap-3 text-xs mb-2">
                        <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm" style={{ background: '#16a34a' }} /> Strong ≥80%</span>
                        <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm" style={{ background: '#c8860a' }} /> Moderate 60–79%</span>
                        <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm" style={{ background: '#ef4444' }} /> Weak &lt;60%</span>
                        <span className="flex items-center gap-1 ml-2 border-l pl-3 border-gray-200">
                          <span className="inline-block w-5 border-t-2 border-dashed" style={{ borderColor: NAV }} />
                          <span className="text-gray-500">— line = no. of tests (right axis)</span>
                        </span>
                      </div>
                      {sciTopics.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-green-700 mb-2">Science — Chapter Wise</p>
                          <ChapterBarChart topics={sciTopics} />
                        </div>
                      )}
                      {mathTopics.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-orange-700 mb-2">Maths — Chapter Wise</p>
                          <ChapterBarChart topics={mathTopics} />
                        </div>
                      )}
                    </>
                }
              </div>
            )}

            {/* Strong Topics */}
            {tab === 'strong' && (
              <div className="p-4">
                {strongTopics.length === 0
                  ? <p className="text-sm text-gray-400 py-4 text-center">No strong topics yet.</p>
                  : <ModalTopicTable topics={strongTopics} type="strong" />
                }
              </div>
            )}

            {/* Moderate Topics */}
            {tab === 'moderate' && (
              <div className="p-4">
                {moderateTopics.length === 0
                  ? <p className="text-sm text-gray-400 py-4 text-center">No moderate topics.</p>
                  : <ModalTopicTable topics={moderateTopics} type="moderate" />
                }
              </div>
            )}

            {/* Weak Topics */}
            {tab === 'weak' && (
              <div className="p-4">
                {weakTopics.length === 0
                  ? <p className="text-sm text-gray-400 py-4 text-center">No weak topics — great work!</p>
                  : <ModalTopicTable topics={weakTopics} type="weak" />
                }
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function DeltaBadge({ delta }) {
  if (delta === null || delta === undefined) return (
    <span style={{ color: 'rgba(200,134,10,0.3)', fontSize: '13px' }}>—</span>
  )
  if (delta === 0) return (
    <span style={{
      display: 'inline-block', fontSize: '10px', fontWeight: 600,
      padding: '2px 8px', borderRadius: '999px',
      background: 'rgba(200,134,10,0.1)', color: 'var(--faint)',
      border: '1px solid rgba(200,134,10,0.22)',
    }}>±0%</span>
  )
  const pos = delta > 0
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '3px',
      fontSize: '10px', fontWeight: 700,
      padding: '2px 9px', borderRadius: '999px',
      background: pos ? 'rgba(34,197,94,0.13)' : 'rgba(239,68,68,0.13)',
      color: pos ? '#4ade80' : '#f87171',
      border: `1px solid ${pos ? 'rgba(34,197,94,0.32)' : 'rgba(239,68,68,0.32)'}`,
      boxShadow: pos ? '0 0 6px rgba(34,197,94,0.18)' : '0 0 6px rgba(239,68,68,0.18)',
    }}>
      <span style={{ fontSize: '7px', lineHeight: 1 }}>{pos ? '▲' : '▼'}</span>
      {pos ? '+' : ''}{delta}%
    </span>
  )
}

function ModalTopicTable({ topics, type, countLabel = 'Tests' }) {
  const cfg = {
    strong:   { border: 'rgba(22,163,74,0.25)',  bg: 'rgba(22,163,74,0.1)',   hover: 'hover:bg-green-50',  color: 'text-green-400',  bar: '#22c55e' },
    moderate: { border: 'rgba(200,134,10,0.3)',  bg: 'rgba(200,134,10,0.1)',  hover: 'hover:bg-amber-50',  color: 'text-amber-400',  bar: '#c8860a' },
    weak:     { border: 'rgba(239,68,68,0.25)',  bg: 'rgba(239,68,68,0.1)',   hover: 'hover:bg-red-50',    color: 'text-red-400',    bar: '#ef4444' },
  }[type]
  return (
    <div className="overflow-x-auto rounded-lg border" style={{ borderColor: cfg.border }}>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-gray-500 uppercase" style={{ background: cfg.bg }}>
            <th className="px-4 py-2">Chapter / Topic</th>
            <th className="px-4 py-2">Subject</th>
            <th className="px-4 py-2 text-center">{countLabel}</th>
            <th className="px-4 py-2 text-center">Avg %</th>
            <th className="px-4 py-2 text-center">Best</th>
            <th className="px-4 py-2 text-center">Worst</th>
            <th className="px-4 py-2">Progress</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {topics.map((t) => (
            <tr key={t.topic} className={cfg.hover}>
              <td className="px-4 py-2 font-medium text-gray-800 text-xs">{t.topic}</td>
              <td className="px-4 py-2">
                <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${t.subject === 'Science' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>{t.subject}</span>
              </td>
              <td className="px-4 py-2 text-center text-gray-600 text-xs">{t.count}</td>
              <td className="px-4 py-2 text-center">
                <span className={`font-bold text-sm ${cfg.color}`}>{t.avg}%</span>
              </td>
              <td className="px-4 py-2 text-center text-green-600 font-medium text-xs">{t.best}%</td>
              <td className="px-4 py-2 text-center text-red-500 font-medium text-xs">{t.worst}%</td>
              <td className="px-4 py-2 w-24">
                <div className="w-full bg-gray-100 rounded-full h-1.5">
                  <div className="h-1.5 rounded-full" style={{ width: `${t.avg}%`, background: cfg.bar }} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ChapterBarChart({ topics }) {
  const data = topics.map((t) => ({
    topic: t.topic.length > 18 ? t.topic.slice(0, 18) + '…' : t.topic,
    fullTopic: t.topic,
    avg: t.avg,
    count: t.count,
    best: t.best,
    worst: t.worst,
    fill: t.avg >= 80 ? '#16a34a' : t.avg >= 60 ? '#c8860a' : '#ef4444',
  }))

  const maxCount = Math.max(...data.map((d) => d.count), 1)

  return (
    <ResponsiveContainer width="100%" height={Math.max(220, data.length * 52 + 60)}>
      <ComposedChart data={data} margin={{ top: 16, right: 50, left: 0, bottom: 60 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(200,134,10,0.12)" />
        <XAxis
          dataKey="topic"
          tick={{ fontSize: 10, fill: 'var(--faint)' }}
          angle={-35}
          textAnchor="end"
          interval={0}
          height={70}
        />
        <YAxis
          yAxisId="pct"
          domain={[0, 100]}
          tick={{ fontSize: 10, fill: 'var(--faint)' }}
          unit="%"
          label={{ value: 'Avg %', angle: -90, position: 'insideLeft', fontSize: 10, fill: 'var(--faint)', offset: 10 }}
        />
        <YAxis
          yAxisId="cnt"
          orientation="right"
          domain={[0, maxCount + 1]}
          tick={{ fontSize: 10, fill: 'var(--faint)' }}
          allowDecimals={false}
          label={{ value: 'Tests', angle: 90, position: 'insideRight', fontSize: 10, fill: 'var(--faint)', offset: 10 }}
        />
        <Tooltip
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null
            const d = payload[0].payload
            return (
              <div className="bg-white border border-gray-200 rounded-lg px-3 py-2 text-xs shadow space-y-0.5">
                <p className="font-semibold text-gray-800 mb-1">{d.fullTopic}</p>
                <p style={{ color: d.fill }}>Avg: <strong>{d.avg}%</strong></p>
                <p className="text-gray-500">Tests taken: <strong>{d.count}</strong></p>
                <p className="text-green-600">Best: {d.best}%</p>
                <p className="text-red-500">Worst: {d.worst}%</p>
              </div>
            )
          }}
        />
        <ReferenceLine yAxisId="pct" y={80} stroke="#16a34a" strokeDasharray="4 3" strokeWidth={1}
          label={{ value: '80%', position: 'insideTopRight', fontSize: 9, fill: '#16a34a' }} />
        <ReferenceLine yAxisId="pct" y={60} stroke="#c8860a" strokeDasharray="4 3" strokeWidth={1}
          label={{ value: '60%', position: 'insideTopRight', fontSize: 9, fill: '#c8860a' }} />
        <Bar yAxisId="pct" dataKey="avg" radius={[4, 4, 0, 0]}
          label={{ position: 'top', fontSize: 9, fill: 'var(--faint)', formatter: (v) => `${v}%` }}
        >
          {data.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
        </Bar>
        <Line
          yAxisId="cnt"
          type="monotone"
          dataKey="count"
          stroke={NAV}
          strokeWidth={2}
          dot={{ fill: NAV, r: 4, strokeWidth: 0 }}
          label={{ position: 'top', fontSize: 9, fill: NAV, formatter: (v) => `${v}t` }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  )
}

function MiniStat({ label, value, highlight, positive, negative }) {
  let style = { background: '#f5ede0', border: '1px solid #dfc8a0' }
  let labelColor = '#7a5530'
  let valueColor = '#3d1f00'
  if (highlight) { style = { background: '#fffbf2', border: `1px solid ${GOLD}` }; labelColor = '#92400e'; valueColor = GOLD }
  if (positive)  { style = { background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.25)' }; labelColor = '#16a34a'; valueColor = '#15803d' }
  if (negative)  { style = { background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)' }; labelColor = '#ef4444'; valueColor = '#dc2626' }
  return (
    <div className="rounded-lg p-3 text-center" style={style}>
      <p className="text-xs mb-1" style={{ color: labelColor }}>{label}</p>
      <p className="text-lg font-bold" style={{ color: valueColor }}>{value}</p>
    </div>
  )
}
