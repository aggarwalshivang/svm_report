import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
  BarChart, Bar, ResponsiveContainer, ComposedChart, Cell,
} from 'recharts'
import { supabase } from '../lib/supabase'
import { ThemeToggle } from '../lib/theme.jsx'
import {
  computeSubmissionPerformance, aggregateChapterStats, aggregateSubjectStats,
  topRecurringIssues, classifyChapters, buildSuggestion,
} from '../lib/worksheetAnalysis'

const GOLD  = 'var(--gold)'
const NAV   = 'var(--nav)'
const DARK  = 'var(--page-bg)'

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

// Status priority: turning a worksheet in — a teacher-marked "completed"
// flag, an in-app upload (assignment_submissions), or a matched
// worksheet_feedback row (graded feedback is itself proof it was handed in)
// — always shows Completed; there's no separate "submitted, awaiting
// feedback" state. Then Closed (teacher shut off submissions early —
// distinct from Missing, since the deadline may not have passed yet),
// Missing (deadline passed, nothing turned in) or Assigned (still open).
function assignmentStatus(a, submission, feedback) {
  if (a.completed || submission || feedback) {
    const late = submission && a.deadline && new Date(submission.submitted_at) > new Date(a.deadline)
    return late
      ? { key: 'completed', label: '✓ Completed (late)', color: '#16a34a', bg: 'rgba(34,197,94,0.12)' }
      : { key: 'completed', label: '✓ Completed', color: '#16a34a', bg: 'rgba(34,197,94,0.12)' }
  }
  if (a.submissions_closed) return { key: 'closed', label: '🔒 Closed', color: '#6b7280', bg: 'rgba(107,114,128,0.14)' }
  if (a.deadline && new Date(a.deadline) < new Date()) return { key: 'missing', label: 'Missing', color: '#dc2626', bg: 'rgba(220,38,38,0.12)' }
  return { key: 'assigned', label: 'Assigned', color: GOLD, bg: 'rgba(200,134,10,0.12)' }
}

// worksheet_feedback is a one-off import from the school's old Google Form
// process, which names worksheets in its own free-text, evolving way (e.g.
// "Algebraic Identities till Example 16") — never the same string as this
// app's clean assignment titles (e.g. "Exploring Algebraic Identities"), so
// there's no exact key to join on. Score every (assignment, feedback) pair by
// title word-overlap + subject compatibility, then greedily pair off the
// best-scoring matches so each assignment gets at most one feedback row.
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

// worksheet_feedback rows store text prefixed with "[Assignment Name, Class N,
// Subject] " so a row reads standalone without a join — redundant once shown
// on the assignment's own card, so strip it back off for display.
function stripFeedbackContext(text) {
  return (text || '').replace(/^\[[^\]]*\]\s*/, '')
}

export default function StudentDashboard() {
  const navigate = useNavigate()
  const session = JSON.parse(localStorage.getItem('svm_session') || 'null')

  const [scores, setScores] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('all')
  const [subjectFilter, setSubjectFilter] = useState('All')
  const [sortBy, setSortBy] = useState('date-desc') // date-asc | date-desc | pct-asc | pct-desc | subject
  const [classRank, setClassRank] = useState(null)
  const [classSize, setClassSize] = useState(null)
  const [assignments, setAssignments] = useState([])
  const [submissions, setSubmissions] = useState([]) // this student's assignment_submissions rows
  const [worksheetFeedback, setWorksheetFeedback] = useState([]) // this student's worksheet_feedback rows
  const [section, setSection] = useState('report') // report | assignments
  const [assignmentView, setAssignmentView] = useState('list') // list | performance
  const [assignmentFilter, setAssignmentFilter] = useState('all') // all | assigned | missing | submitted | completed
  const [assignmentSort, setAssignmentSort] = useState('deadline-desc') // deadline-asc | deadline-desc | subject
  const [assignmentSubjectFilter, setAssignmentSubjectFilter] = useState('All') // All | Maths | Science
  const [assignmentSearch, setAssignmentSearch] = useState('')

  useEffect(() => {
    if (!session?.studentId) return
    async function load() {
      const { data: profile } = await supabase
        .from('student_emails')
        .select('report_start_date')
        .eq('student_id', session.studentId)
        .limit(1)
        .maybeSingle()
      const cutoff = profile?.report_start_date ?? null

      const { data } = await supabase
        .from('student_scores')
        .select('*')
        .eq('student_id', session.studentId)
        .order('date', { ascending: true })

      const rows = cutoff ? (data || []).filter((s) => s.date >= cutoff) : (data || [])
      setScores(rows)
      setLoading(false)
    }
    load()
  }, [session?.studentId])

  useEffect(() => {
    if (!session?.studentId || !session?.class) return
    async function computeRank() {
      // Ranking classmates requires reading their scores too, which RLS
      // (fix-student-data-select-rls.sql) restricts to "own rows only" for
      // students — so this runs server-side via a security-definer RPC
      // (see scripts/create-class-rank-rpc.sql) that returns just the
      // caller's own rank + class size, never other students' data.
      const { data, error } = await supabase.rpc('get_my_class_rank').maybeSingle()
      if (error || !data) return
      setClassRank(data.rank ?? null)
      setClassSize(data.class_size ?? null)
    }
    computeRank()
  }, [session?.studentId, session?.class])

  useEffect(() => {
    if (!session?.class) return
    async function loadAssignments() {
      const { data } = await supabase
        .from('assignments')
        .select('*')
        .eq('class', session.class)
        .order('deadline', { ascending: false })
      setAssignments(data || [])
    }
    loadAssignments()
  }, [session?.class])

  useEffect(() => {
    if (!session?.studentId) return
    async function load() {
      const { data } = await supabase
        .from('assignment_submissions')
        .select('*')
        .eq('student_id', session.studentId)
      setSubmissions(data || [])
    }
    load()
  }, [session?.studentId])

  useEffect(() => {
    if (!session?.studentId) return
    async function load() {
      const { data } = await supabase
        .from('worksheet_feedback')
        .select('*')
        .eq('student_id', session.studentId)
      setWorksheetFeedback(data || [])
    }
    load()
  }, [session?.studentId])

  // Re-fetched (not run inside an effect) after a card's Submit succeeds.
  async function loadSubmissions() {
    if (!session?.studentId) return
    const { data } = await supabase
      .from('assignment_submissions')
      .select('*')
      .eq('student_id', session.studentId)
    setSubmissions(data || [])
  }

  const submissionByAssignment = useMemo(() => {
    const map = {}
    submissions.forEach((s) => { map[s.assignment_id] = s })
    return map
  }, [submissions])

  // worksheet_feedback rows already belong to this exact student (queried by
  // student_id above) but have no assignment_id, just a subject + free-text
  // assignment_name — so pairing a row with the right card still needs a
  // best-effort match. Each assignment independently picks its own
  // best-scoring compatible feedback row (title word-overlap + subject match,
  // ties broken by how close submitted_at is to the deadline). Deliberately
  // not unique on the feedback side: a single combined submission (e.g.
  // "Algebraic Identities | Motion", subject "Math & Science") can be the
  // right match for two separate assignment cards at once.
  const feedbackByAssignmentId = useMemo(() => {
    const map = {}
    assignments.forEach((a) => {
      // A row already tagged with this exact assignment (live in-app
      // submissions always set assignment_id) is definitive proof — skip
      // fuzzy matching. Rows tagged for a *different* assignment must never
      // be fuzzy-matched here either; only untagged legacy CSV-import rows
      // (assignment_id null) go through title matching, and only if they
      // postdate this assignment's own creation — an old Google-Form-import
      // row can't be a submission to a worksheet that didn't exist yet, no
      // matter how similar the title reads.
      let best = worksheetFeedback.find((f) => f.assignment_id === a.id) || null
      if (!best) {
        const aWords = sigWords(a.title)
        const deadlineMs = new Date(a.deadline).getTime()
        const createdMs = new Date(a.created_at).getTime()
        let bestScore = 0, bestDateDiff = Infinity
        worksheetFeedback.forEach((f) => {
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
      }
      if (best) map[a.id] = best
    })
    return map
  }, [assignments, worksheetFeedback])

  // Worksheet performance analysis — derived by text-mining assignment_feedback
  // (worksheets carry no marks/chapter tag of their own), built on top of the
  // assignment<->feedback matches above.
  const worksheetSubmissionPerf = useMemo(() => {
    const rows = []
    assignments.forEach((a) => {
      const row = computeSubmissionPerformance(a, feedbackByAssignmentId[a.id])
      if (row) rows.push(row)
    })
    return rows
  }, [assignments, feedbackByAssignmentId])

  const worksheetChapterStats = useMemo(() => aggregateChapterStats(worksheetSubmissionPerf), [worksheetSubmissionPerf])
  const worksheetSubjectStats = useMemo(() => aggregateSubjectStats(worksheetSubmissionPerf), [worksheetSubmissionPerf])
  const worksheetRecurringIssues = useMemo(() => topRecurringIssues(worksheetSubmissionPerf), [worksheetSubmissionPerf])

  const assignmentsWithStatus = useMemo(
    () => assignments.map((a) => ({
      ...a,
      submission: submissionByAssignment[a.id] || null,
      status: assignmentStatus(a, submissionByAssignment[a.id], feedbackByAssignmentId[a.id]),
      feedback: feedbackByAssignmentId[a.id] || null,
    })),
    [assignments, submissionByAssignment, feedbackByAssignmentId]
  )

  const missingCount  = useMemo(() => assignmentsWithStatus.filter((a) => a.status.key === 'missing').length, [assignmentsWithStatus])
  const upcomingCount = useMemo(() => assignmentsWithStatus.filter((a) => a.status.key === 'assigned').length, [assignmentsWithStatus])

  const displayedAssignments = useMemo(() => {
    let rows = assignmentFilter === 'all' ? [...assignmentsWithStatus] : assignmentsWithStatus.filter((a) => a.status.key === assignmentFilter)
    if (assignmentSubjectFilter !== 'All') rows = rows.filter((a) => a.subject === assignmentSubjectFilter)
    const q = assignmentSearch.trim().toLowerCase()
    if (q) rows = rows.filter((a) => a.title.toLowerCase().includes(q))
    if (assignmentSort === 'deadline-asc')  rows.sort((a, b) => new Date(a.deadline) - new Date(b.deadline))
    if (assignmentSort === 'deadline-desc') rows.sort((a, b) => new Date(b.deadline) - new Date(a.deadline))
    if (assignmentSort === 'subject')       rows.sort((a, b) => a.subject.localeCompare(b.subject))
    return rows
  }, [assignmentsWithStatus, assignmentFilter, assignmentSubjectFilter, assignmentSearch, assignmentSort])

  function logout() {
    localStorage.removeItem('svm_session')
    navigate('/')
  }

  const appeared = useMemo(() => scores.filter((s) => !s.is_absent), [scores])
  const absentCount = scores.filter((s) => s.is_absent).length

  const avgPct = appeared.length > 0
    ? (appeared.reduce((sum, s) => sum + (s.score_obtained / s.total_marks) * 100, 0) / appeared.length).toFixed(1)
    : 0

  const sciScores  = appeared.filter((s) => s.subject === 'Science')
  const mathScores = appeared.filter((s) => s.subject === 'Maths')
  const sciAvg  = sciScores.length  ? (sciScores.reduce((a, s)  => a + (s.score_obtained / s.total_marks) * 100, 0) / sciScores.length).toFixed(1)  : 0
  const mathAvg = mathScores.length ? (mathScores.reduce((a, s) => a + (s.score_obtained / s.total_marks) * 100, 0) / mathScores.length).toFixed(1) : 0
  const bestSubject = Number(sciAvg) >= Number(mathAvg) ? 'Science' : 'Maths'

  // Topic analysis
  const topicStats = useMemo(() => {
    const map = {}
    appeared.forEach((s) => {
      if (!map[s.topic_name]) map[s.topic_name] = { topic: s.topic_name, subject: s.subject, total: 0, count: 0, best: 0, worst: 100 }
      const pct = (s.score_obtained / s.total_marks) * 100
      map[s.topic_name].total  += pct
      map[s.topic_name].count  += 1
      map[s.topic_name].best    = Math.max(map[s.topic_name].best, pct)
      map[s.topic_name].worst   = Math.min(map[s.topic_name].worst, pct)
    })
    return Object.values(map).map((t) => ({ ...t, avg: +(t.total / t.count).toFixed(1), best: +t.best.toFixed(1), worst: +t.worst.toFixed(1) }))
  }, [appeared])

  const strongTopics   = useMemo(() => topicStats.filter((t) => t.avg >= 80).sort((a, b) => b.avg - a.avg), [topicStats])
  const moderateTopics = useMemo(() => topicStats.filter((t) => t.avg >= 60 && t.avg < 80).sort((a, b) => b.avg - a.avg), [topicStats])
  const weakTopics     = useMemo(() => topicStats.filter((t) => t.avg <  60).sort((a, b) => a.avg - b.avg), [topicStats])

  // Chart data — sorted by date for the trend line
  const trendData = [...appeared]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((s) => ({
      date: s.date.slice(5),
      pct:  +((s.score_obtained / s.total_marks) * 100).toFixed(1),
      subject: s.subject,
    }))

  // Delta map: change vs previous test, keyed by score id
  const deltaMap = useMemo(() => {
    const sorted = [...appeared].sort((a, b) => a.date.localeCompare(b.date))
    const map = {}
    sorted.forEach((s, i) => {
      if (i === 0) { map[s.id] = null; return }
      const prevPct = (sorted[i - 1].score_obtained / sorted[i - 1].total_marks) * 100
      const currPct = (s.score_obtained / s.total_marks) * 100
      map[s.id] = +(currPct - prevPct).toFixed(1)
    })
    return map
  }, [appeared])

  const subjectChartData = [
    { subject: 'Science', avg: Number(sciAvg) },
    { subject: 'Maths',   avg: Number(mathAvg) },
  ]

  const recentTests = [...scores].reverse().slice(0, 5)

  const displayedScores = useMemo(() => {
    let rows = subjectFilter === 'All' ? [...scores] : scores.filter((s) => s.subject === subjectFilter)
    if (sortBy === 'date-asc')  rows.sort((a, b) => a.date.localeCompare(b.date))
    if (sortBy === 'date-desc') rows.sort((a, b) => b.date.localeCompare(a.date))
    if (sortBy === 'pct-asc')   rows.sort((a, b) => {
      const pa = a.is_absent ? -1 : a.score_obtained / a.total_marks
      const pb = b.is_absent ? -1 : b.score_obtained / b.total_marks
      return pa - pb
    })
    if (sortBy === 'pct-desc')  rows.sort((a, b) => {
      const pa = a.is_absent ? -1 : a.score_obtained / a.total_marks
      const pb = b.is_absent ? -1 : b.score_obtained / b.total_marks
      return pb - pa
    })
    if (sortBy === 'subject')   rows.sort((a, b) => a.subject.localeCompare(b.subject))
    return rows
  }, [scores, subjectFilter, sortBy])

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: DARK }}>
      <div className="text-center">
        <div className="w-14 h-14 rounded-2xl overflow-hidden mx-auto mb-4" style={{ background: NAV }}>
          <img src="/shivang.png" alt="Saraswati VidyaMandir" className="w-full h-full object-cover" />
        </div>
        <p className="font-semibold text-sm" style={{ color: 'var(--muted)' }}>Loading your report…</p>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen" style={{ background: DARK }}>
      {/* Navbar */}
      <nav className="px-5 py-3 flex items-center justify-between" style={{ background: NAV, color: 'var(--text)', borderBottom: `2px solid ${GOLD}`, boxShadow: '0 2px 8px rgba(0,0,0,0.15)' }}>
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-xl overflow-hidden flex-shrink-0" style={{ background: GOLD }}>
            <img src="/shivang.png" alt="Saraswati VidyaMandir" className="w-full h-full object-cover" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm hidden sm:block">Saraswati VidyaMandir</span>
              <span className="font-bold text-sm sm:hidden">SVM</span>
              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold flex-shrink-0" style={{ background: 'rgba(200,134,10,0.15)', border: '1px solid rgba(200,134,10,0.3)' }}>
                Class {session?.class}
              </span>
            </div>
            <p className="text-xs font-semibold truncate mt-0.5" style={{ color: GOLD }}>{session?.studentName}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <ThemeToggle />
          <button
            onClick={logout}
            className="text-xs px-3 py-1.5 rounded-lg font-medium transition border"
            style={{ background: 'transparent', borderColor: 'rgba(200,134,10,0.3)', color: 'var(--muted)' }}
            onMouseEnter={(e) => { e.currentTarget.style.background = GOLD; e.currentTarget.style.borderColor = GOLD; e.currentTarget.style.color = 'white' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'rgba(200,134,10,0.3)'; e.currentTarget.style.color = 'var(--muted)' }}
          >
            Logout
          </button>
        </div>
      </nav>

      <div className="max-w-6xl mx-auto p-3 sm:p-6 space-y-5">

        {/* ── SECTION SWITCHER ── */}
        <div className="flex gap-2">
          {[
            { key: 'report',      label: '📊 My Report' },
            { key: 'assignments', label: `📌 Worksheets${assignments.length ? ` (${assignments.length})` : ''}${missingCount ? ` · ${missingCount} missing` : ''}` },
          ].map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setSection(key)}
              className="px-4 py-2 rounded-lg text-xs sm:text-sm font-semibold transition"
              style={section === key
                ? { background: GOLD, color: 'white' }
                : { background: 'rgba(200,134,10,0.12)', color: 'var(--muted)', border: '1px solid rgba(200,134,10,0.25)' }
              }
            >
              {label}
            </button>
          ))}
        </div>

        {section === 'report' && (
        <>
        {/* ── SUMMARY ROW ── */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
          <StatCard label="Total Tests"  value={scores.length}     sub={`${appeared.length} appeared`} type="gold" />
          <StatCard label="Overall Avg"  value={`${avgPct}%`}      sub={avgPct >= 75 ? 'Great work!' : avgPct >= 60 ? 'Keep going' : 'Needs effort'} type="green" />
          <StatCard label="Absences"     value={absentCount}        sub={absentCount === 0 ? 'Perfect attendance' : 'tests missed'} type="red" />
          <StatCard label="Best Subject" value={bestSubject}        sub={bestSubject === 'Science' ? `${sciAvg}% avg` : `${mathAvg}% avg`} type="brown" />
          <StatCard
            label="Class Rank"
            value={classRank != null ? `#${classRank}` : classSize !== null ? '—' : '…'}
            sub={classSize !== null ? `out of ${classSize} in Class ${session?.class}` : 'Computing…'}
            type="rank"
          />
        </div>

        {/* ── CHARTS + RECENT TESTS ── */}
        <div className="grid md:grid-cols-3 gap-3">
          {/* Trend line */}
          <div className="md:col-span-2 bg-white rounded-xl shadow p-3 sm:p-4">
            <h2 className="text-sm font-semibold mb-3 flex items-center gap-2" style={{ color: 'var(--text)' }}>
              <span className="inline-block w-1 h-4 rounded-full" style={{ background: GOLD }} />
              Score Trend (%)
            </h2>
            {trendData.length === 0
              ? <p className="text-xs text-gray-400 py-8 text-center">No data yet.</p>
              : (
                <ResponsiveContainer width="100%" height={180}>
                  <LineChart data={trendData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(200,134,10,0.12)" />
                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--faint)' }} minTickGap={48} interval="preserveStartEnd" />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: 'var(--faint)' }} unit="%" />
                    <ReferenceLine y={80} stroke="#16a34a" strokeDasharray="4 3" strokeWidth={1.5}
                      label={{ value: '80%', position: 'insideTopRight', fontSize: 10, fill: '#16a34a' }} />
                    <Tooltip formatter={(v) => `${v}%`} />
                    <Line type="monotone" dataKey="pct" stroke={GOLD} strokeWidth={2} name="Score %"
                      dot={(props) => {
                        const { cx, cy, payload } = props
                        const color = payload.pct >= 80 ? '#16a34a' : '#ef4444'
                        return <circle key={`dot-${cx}-${cy}`} cx={cx} cy={cy} r={3.5} fill={color} stroke="white" strokeWidth={1} />
                      }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              )
            }
          </div>

          {/* Subject avg + recent tests */}
          <div className="flex flex-col gap-3">
            <div className="bg-white rounded-xl shadow p-3 sm:p-4">
              <h2 className="text-sm font-semibold mb-3 flex items-center gap-2" style={{ color: 'var(--text)' }}>
                <span className="inline-block w-1 h-4 rounded-full" style={{ background: GOLD }} />
                Subject Avg
              </h2>
              <ResponsiveContainer width="100%" height={100}>
                <BarChart data={subjectChartData} barSize={32}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(200,134,10,0.12)" />
                  <XAxis dataKey="subject" tick={{ fontSize: 11, fill: 'var(--faint)' }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: 'var(--faint)' }} unit="%" />
                  <Tooltip formatter={(v) => `${v}%`} />
                  <Bar dataKey="avg" radius={[6, 6, 0, 0]} fill={GOLD} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="bg-white rounded-xl shadow p-3 sm:p-4 flex-1">
              <h2 className="text-sm font-semibold mb-3 flex items-center gap-2" style={{ color: 'var(--text)' }}>
                <span className="inline-block w-1 h-4 rounded-full" style={{ background: GOLD }} />
                Recent Tests
              </h2>
              <div className="space-y-2">
                {recentTests.length === 0 && <p className="text-xs text-gray-400">No tests yet.</p>}
                {recentTests.map((s) => {
                  const pct = s.is_absent ? null : +((s.score_obtained / s.total_marks) * 100).toFixed(1)
                  return (
                    <div key={s.id} className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-gray-700 truncate">{s.topic_name}</p>
                        <p className="text-[10px] text-gray-400">{s.date.slice(5)} · {s.subject}</p>
                      </div>
                      {s.is_absent
                        ? <span className="text-xs text-red-400 font-medium flex-shrink-0">Absent</span>
                        : <span className={`text-xs font-bold flex-shrink-0 ${pct >= 80 ? 'text-green-600' : pct >= 60 ? 'text-amber-600' : 'text-red-500'}`}>
                            {pct}%
                          </span>
                      }
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>

        {/* ── TABBED PANEL ── */}
        <div className="bg-white rounded-xl shadow overflow-hidden">
          {/* Tab bar — scrollable on mobile */}
          <div className="flex border-b border-gray-100 overflow-x-auto scrollbar-none" style={{ WebkitOverflowScrolling: 'touch' }}>
            {[
              { key: 'all',      label: '📋 All Tests',         count: scores.length },
              { key: 'strong',   label: '🏆 Strong (≥80%)',     count: strongTopics.length },
              { key: 'moderate', label: '📊 Moderate (60–79%)', count: moderateTopics.length },
              { key: 'weak',     label: '⚠️ Weak (<60%)',       count: weakTopics.length },
            ].map(({ key, label, count }) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className="flex items-center gap-1.5 px-4 py-3 text-xs sm:text-sm font-medium transition border-b-2 -mb-px whitespace-nowrap flex-shrink-0"
                style={tab === key
                  ? { borderColor: GOLD, color: GOLD }
                  : { borderColor: 'transparent', color: '#6b7280' }
                }
              >
                {label}
                <span className={`text-xs rounded-full px-1.5 py-0.5 font-bold ${
                  tab === key ? 'text-white' : 'bg-gray-100 text-gray-500'
                }`} style={tab === key ? { background: GOLD } : {}}>
                  {count}
                </span>
              </button>
            ))}
          </div>

          {/* ── All Tests ── */}
          {tab === 'all' && (
            <>
              {/* Filter + Sort bar */}
              <div className="px-3 sm:px-5 py-2.5 flex flex-wrap items-center gap-2 border-b border-gray-100" style={{ background: 'rgba(200,134,10,0.06)' }}>
                <div className="flex gap-1.5">
                  {['All', 'Science', 'Maths'].map((f) => (
                    <button key={f} onClick={() => setSubjectFilter(f)}
                      className="px-3 py-1 rounded-full text-xs font-medium transition"
                      style={subjectFilter === f ? { background: GOLD, color: 'white' } : { background: 'rgba(200,134,10,0.12)', color: 'var(--faint)' }}
                    >{f}</button>
                  ))}
                </div>
                <div className="w-px h-4 bg-gray-200 hidden sm:block" />
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-xs text-gray-400">Sort:</span>
                  {[
                    { key: 'date-desc', label: 'Date ↓' },
                    { key: 'date-asc',  label: 'Date ↑' },
                    { key: 'pct-desc',  label: '% ↓' },
                    { key: 'pct-asc',   label: '% ↑' },
                    { key: 'subject',   label: 'Subject' },
                  ].map(({ key, label }) => (
                    <button key={key} onClick={() => setSortBy(key)}
                      className="px-2.5 py-1 rounded text-xs font-medium transition"
                      style={sortBy === key
                        ? { background: 'rgba(200,134,10,0.22)', color: GOLD, border: '1px solid rgba(200,134,10,0.4)' }
                        : { background: 'rgba(200,134,10,0.06)', color: 'var(--faint)', border: '1px solid rgba(200,134,10,0.2)' }}
                    >{label}</button>
                  ))}
                </div>
                <span className="ml-auto text-xs text-gray-400">{displayedScores.length} tests</span>
              </div>

              {/* Scrollable table */}
              <div className="table-scroll" style={{ overflowX: 'auto' }}>
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 z-10">
                      <tr className="text-left text-xs text-gray-500 uppercase tracking-wide" style={{ background: 'rgba(200,134,10,0.08)' }}>
                        <th className="px-5 py-3 cursor-pointer hover:text-amber-700 select-none"
                          onClick={() => setSortBy(sortBy === 'date-desc' ? 'date-asc' : 'date-desc')}>
                          Date {sortBy === 'date-desc' ? '↓' : sortBy === 'date-asc' ? '↑' : ''}
                        </th>
                        <th className="px-5 py-3 cursor-pointer hover:text-amber-700 select-none"
                          onClick={() => setSortBy('subject')}>
                          Subject {sortBy === 'subject' ? '↓' : ''}
                        </th>
                        <th className="px-5 py-3">Topic</th>
                        <th className="px-5 py-3 text-center">Score</th>
                        <th className="px-5 py-3 text-center">Total</th>
                        <th className="px-5 py-3 text-center cursor-pointer hover:text-amber-700 select-none"
                          onClick={() => setSortBy(sortBy === 'pct-desc' ? 'pct-asc' : 'pct-desc')}>
                          % {sortBy === 'pct-desc' ? '↓' : sortBy === 'pct-asc' ? '↑' : ''}
                        </th>
                        <th className="px-5 py-3 text-center hidden sm:table-cell">Δ</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {displayedScores.map((s) => {
                        const pct   = s.is_absent ? null : +((s.score_obtained / s.total_marks) * 100).toFixed(1)
                        const delta = s.is_absent ? null : deltaMap[s.id]
                        return (
                          <tr key={s.id} className="hover:bg-amber-50 transition">
                            <td className="px-5 py-3 text-gray-600 text-xs">{s.date}</td>
                            <td className="px-5 py-3">
                              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${s.subject === 'Science' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>
                                {s.subject}
                              </span>
                            </td>
                            <td className="px-5 py-3 text-gray-700 max-w-xs truncate">{s.topic_name}</td>
                            <td className="px-5 py-3 text-center font-medium text-gray-800">
                              {s.is_absent ? <span className="text-red-500 text-xs">Absent</span> : s.score_obtained}
                            </td>
                            <td className="px-5 py-3 text-center text-gray-500">{s.total_marks}</td>
                            <td className="px-5 py-3 text-center">
                              {pct !== null
                                ? <span className={`font-bold text-sm ${pct >= 80 ? 'text-green-600' : pct >= 60 ? 'text-amber-600' : 'text-red-500'}`}>{pct}%</span>
                                : '—'}
                            </td>
                            <td className="px-5 py-3 text-center hidden sm:table-cell">
                              <DeltaBadge delta={delta} />
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                  {displayedScores.length === 0 && <p className="text-center text-gray-400 py-10 text-sm">No tests found.</p>}
              </div>
            </>
          )}

          {/* ── Strong Topics ── */}
          {tab === 'strong' && (
            <div className="p-5">
              <p className="text-xs text-gray-400 mb-3">Topics where your average is 80% or above — keep it up!</p>
              {strongTopics.length === 0
                ? <p className="text-gray-400 text-sm py-6 text-center">No topics at 80%+ yet. Keep practicing!</p>
                : <TopicTable topics={strongTopics} type="strong" />
              }
            </div>
          )}

          {/* ── Moderate Topics ── */}
          {tab === 'moderate' && (
            <div className="p-5">
              <p className="text-xs text-gray-400 mb-3">Topics where your average is 60–79% — a little more practice and you'll ace these!</p>
              {moderateTopics.length === 0
                ? <p className="text-gray-400 text-sm py-6 text-center">No topics in the moderate range.</p>
                : <TopicTable topics={moderateTopics} type="moderate" />
              }
            </div>
          )}

          {tab === 'weak' && (
            <div className="p-5">
              <p className="text-xs text-gray-400 mb-3">Topics where your average is below 60% — focus here to improve your rank!</p>
              {weakTopics.length === 0
                ? <p className="text-gray-400 text-sm py-6 text-center">No topics below 60% — great work!</p>
                : <TopicTable topics={weakTopics} type="weak" />
              }
            </div>
          )}
        </div>
        </>
        )}

        {/* ── ASSIGNMENTS SECTION ── */}
        {section === 'assignments' && (
          <div className="space-y-4">
            {/* Quick view */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard label="Missing"  value={missingCount}  sub={missingCount ? 'Overdue — submit now' : 'All caught up'} type="red" />
              <StatCard label="Upcoming" value={upcomingCount} sub="Due before deadline" type="gold" />
              <StatCard label="Completed" value={assignmentsWithStatus.filter((a) => a.status.key === 'completed').length} sub="Submitted" type="green" />
              <StatCard label="Checked by Teacher" value={assignmentsWithStatus.filter((a) => a.feedback).length} sub="Feedback received" type="brown" />
            </div>

            {/* List / Performance toggle */}
            <div className="flex gap-2">
              {[
                { key: 'list',        label: '📋 Worksheets' },
                { key: 'performance', label: '📈 Performance' },
              ].map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setAssignmentView(key)}
                  className="px-3.5 py-1.5 rounded-lg text-xs sm:text-sm font-semibold transition"
                  style={assignmentView === key
                    ? { background: GOLD, color: 'white' }
                    : { background: 'rgba(200,134,10,0.12)', color: 'var(--muted)', border: '1px solid rgba(200,134,10,0.25)' }
                  }
                >
                  {label}
                </button>
              ))}
            </div>

            {assignmentView === 'list' && (
              <>
            {/* Filter + Sort bar */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 px-3 sm:px-4 py-2.5 flex flex-wrap items-center gap-2">
              <div className="flex gap-1.5 flex-wrap">
                {[
                  { key: 'all',       label: 'All' },
                  { key: 'assigned',  label: 'Assigned' },
                  { key: 'missing',   label: 'Missing' },
                  { key: 'closed',    label: 'Closed' },
                  { key: 'completed', label: 'Completed' },
                ].map((f) => (
                  <button key={f.key} onClick={() => setAssignmentFilter(f.key)}
                    className="px-3 py-1 rounded-full text-xs font-medium transition"
                    style={assignmentFilter === f.key ? { background: GOLD, color: 'white' } : { background: 'rgba(200,134,10,0.12)', color: 'var(--faint)' }}
                  >{f.label}</button>
                ))}
              </div>
              <div className="w-px h-4 bg-gray-200 hidden sm:block" />
              <div className="flex gap-1.5 flex-wrap">
                {['All', 'Science', 'Maths'].map((f) => (
                  <button key={f} onClick={() => setAssignmentSubjectFilter(f)}
                    className="px-3 py-1 rounded-full text-xs font-medium transition"
                    style={assignmentSubjectFilter === f ? { background: GOLD, color: 'white' } : { background: 'rgba(200,134,10,0.12)', color: 'var(--faint)' }}
                  >{f}</button>
                ))}
              </div>
              <div className="w-px h-4 bg-gray-200 hidden sm:block" />
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-xs text-gray-400">Sort:</span>
                {[
                  { key: 'deadline-asc',  label: 'Deadline ↑' },
                  { key: 'deadline-desc', label: 'Deadline ↓' },
                  { key: 'subject',       label: 'Subject' },
                ].map(({ key, label }) => (
                  <button key={key} onClick={() => setAssignmentSort(key)}
                    className="px-2.5 py-1 rounded text-xs font-medium transition"
                    style={assignmentSort === key
                      ? { background: 'rgba(200,134,10,0.22)', color: GOLD, border: '1px solid rgba(200,134,10,0.4)' }
                      : { background: 'rgba(200,134,10,0.06)', color: 'var(--faint)', border: '1px solid rgba(200,134,10,0.2)' }}
                  >{label}</button>
                ))}
              </div>
              <input
                type="text"
                value={assignmentSearch}
                onChange={(e) => setAssignmentSearch(e.target.value)}
                placeholder="🔍 Search worksheets…"
                className="ml-auto px-3 py-1.5 rounded-lg text-xs border focus:outline-none w-full sm:w-48"
                style={{ borderColor: 'rgba(200,134,10,0.25)', background: 'rgba(200,134,10,0.04)' }}
              />
              <span className="text-xs text-gray-400 whitespace-nowrap">{displayedAssignments.length} shown</span>
            </div>

            {/* Cards */}
            <div className="grid sm:grid-cols-2 gap-3">
              {displayedAssignments.map((a) => (
                <AssignmentCard key={a.id} a={a} session={session} onSubmitted={loadSubmissions} />
              ))}
            </div>
            {displayedAssignments.length === 0 && (
              <p className="text-center text-gray-400 py-10 text-sm bg-white rounded-xl shadow-sm border border-gray-100">
                {assignments.length === 0 ? 'No worksheets yet.' : 'Nothing matches this filter.'}
              </p>
            )}
              </>
            )}

            {assignmentView === 'performance' && (() => {
              const { strong: strongWs, moderate: moderateWs, weak: weakWs } = classifyChapters(worksheetChapterStats)
              const sciWs  = worksheetSubjectStats.find((s) => s.subject === 'Science')
              const mathWs = worksheetSubjectStats.find((s) => s.subject === 'Maths')
              const overallWs = worksheetSubmissionPerf.length
                ? Math.round(worksheetSubmissionPerf.reduce((sum, r) => sum + r.pct, 0) / worksheetSubmissionPerf.length)
                : null

              function issuesFor(chapterStat) {
                return topRecurringIssues(
                  worksheetSubmissionPerf.filter((r) => r.subject === chapterStat.subject && r.chapter === chapterStat.topic),
                  { limit: 1 }
                )
              }

              if (worksheetChapterStats.length === 0) {
                return (
                  <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-8 text-center">
                    <p className="text-sm text-gray-500">Not enough graded worksheets yet to compute performance.</p>
                    <p className="text-xs text-gray-400 mt-1">This fills in once your teacher's feedback mentions specific strengths or mistakes.</p>
                  </div>
                )
              }

              return (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <StatCard label="Overall Worksheet Avg" value={overallWs !== null ? `${overallWs}%` : '—'} sub="From graded feedback" type="gold" />
                    <StatCard label="Science Avg" value={sciWs ? `${sciWs.avg}%` : '—'} sub="Worksheets" type="green" />
                    <StatCard label="Maths Avg" value={mathWs ? `${mathWs.avg}%` : '—'} sub="Worksheets" type="brown" />
                    <StatCard label="Weak Chapters" value={weakWs.length} sub={weakWs.length ? 'Focus here' : 'None — great work!'} type="red" />
                  </div>

                  {worksheetChapterStats.length > 0 && (
                    <div className="bg-white rounded-xl shadow p-3 sm:p-4">
                      <h2 className="text-sm font-semibold mb-3 flex items-center gap-2" style={{ color: 'var(--text)' }}>
                        <span className="inline-block w-1 h-4 rounded-full" style={{ background: GOLD }} />
                        Worksheet Chapter Analysis
                      </h2>
                      <ChapterBarChart topics={worksheetChapterStats} />
                    </div>
                  )}

                  {[
                    { label: '🏆 Strong Chapters',   data: strongWs,   type: 'strong',   empty: 'No chapters above 80% yet.' },
                    { label: '📊 Moderate Chapters',  data: moderateWs, type: 'moderate', empty: 'No moderate chapters.' },
                    { label: '⚠️ Weak Chapters',      data: weakWs,     type: 'weak',     empty: 'No weak chapters — great work!' },
                  ].map(({ label, data, type, empty }) => (
                    <div key={type} className="bg-white rounded-xl shadow overflow-hidden">
                      <div className="px-4 py-3 border-b border-gray-100">
                        <p className="text-sm font-semibold text-gray-700">{label} ({data.length})</p>
                      </div>
                      {data.length === 0
                        ? <p className="text-sm text-gray-400 py-6 text-center">{empty}</p>
                        : <div className="p-3"><TopicTable topics={data} type={type} countLabel="Worksheets" /></div>
                      }
                    </div>
                  ))}

                  <div className="bg-white rounded-xl shadow p-4">
                    <p className="text-sm font-semibold text-gray-700 mb-3">⚠️ Watch out for</p>
                    {worksheetRecurringIssues.length === 0
                      ? <p className="text-xs text-gray-400">No clear recurring mistake pattern detected yet.</p>
                      : (
                        <div className="flex flex-wrap gap-2">
                          {worksheetRecurringIssues.map((issue) => (
                            <span key={issue.key} className="text-xs px-2.5 py-1 rounded-full" style={{ background: 'rgba(239,68,68,0.1)', color: '#dc2626', border: '1px solid rgba(239,68,68,0.25)' }}>
                              {issue.label} · {issue.count}×
                            </span>
                          ))}
                        </div>
                      )
                    }
                  </div>

                  <div className="bg-white rounded-xl shadow p-4">
                    <p className="text-sm font-semibold text-gray-700 mb-3">💡 Suggestions for you</p>
                    {[...weakWs, ...moderateWs].length === 0
                      ? <p className="text-xs text-gray-400">No chapters need extra focus right now — nice work.</p>
                      : (
                        <div className="space-y-2">
                          {[...weakWs, ...moderateWs].map((c) => (
                            <div key={`${c.subject}-${c.topic}`} className="text-xs border border-gray-100 rounded-lg px-3 py-2 bg-gray-50">
                              {buildSuggestion(c, issuesFor(c), { audience: 'student' })}
                            </div>
                          ))}
                        </div>
                      )
                    }
                  </div>
                </div>
              )
            })()}
          </div>
        )}
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
      background: '#78350f', color: '#fde68a',
      border: '1px solid #92400e',
    }}>±0%</span>
  )
  const pos = delta > 0
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '3px',
      fontSize: '10px', fontWeight: 700,
      padding: '2px 9px', borderRadius: '999px',
      background: pos ? '#166534' : '#991b1b',
      color: pos ? '#bbf7d0' : '#fecaca',
      border: `1px solid ${pos ? '#15803d' : '#b91c1c'}`,
      boxShadow: pos ? '0 0 6px rgba(34,197,94,0.35)' : '0 0 6px rgba(239,68,68,0.35)',
    }}>
      <span style={{ fontSize: '7px', lineHeight: 1 }}>{pos ? '▲' : '▼'}</span>
      {pos ? '+' : ''}{delta}%
    </span>
  )
}

function TopicTable({ topics, type, countLabel = 'Tests' }) {
  const cfg = {
    strong:   { border: 'rgba(22,163,74,0.25)',  bg: 'rgba(22,163,74,0.1)',  hover: 'hover:bg-green-50',  color: 'text-green-700',  bar: '#16a34a' },
    moderate: { border: 'rgba(217,119,6,0.25)',  bg: 'rgba(217,119,6,0.08)', hover: 'hover:bg-amber-50',  color: 'text-amber-700',  bar: '#d97706' },
    weak:     { border: 'rgba(239,68,68,0.25)',  bg: 'rgba(239,68,68,0.1)',  hover: 'hover:bg-red-50',    color: 'text-red-600',    bar: '#ef4444' },
  }[type]
  return (
    <div className="overflow-x-auto rounded-lg border" style={{ borderColor: cfg.border }}>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-gray-500 uppercase tracking-wide"
            style={{ background: cfg.bg }}>
            <th className="px-4 py-3">Chapter / Topic</th>
            <th className="px-4 py-3">Subject</th>
            <th className="px-4 py-3 text-center">{countLabel}</th>
            <th className="px-4 py-3 text-center">Avg %</th>
            <th className="px-4 py-3 text-center">Best</th>
            <th className="px-4 py-3 text-center">Worst</th>
            <th className="px-4 py-3">Progress</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {topics.map((t) => (
            <tr key={t.topic} className={`transition ${cfg.hover}`}>
              <td className="px-4 py-3 font-medium text-gray-800">{t.topic}</td>
              <td className="px-4 py-3">
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${t.subject === 'Science' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>
                  {t.subject}
                </span>
              </td>
              <td className="px-4 py-3 text-center text-gray-600">{t.count}</td>
              <td className="px-4 py-3 text-center">
                <span className={`font-bold ${cfg.color}`}>{t.avg}%</span>
              </td>
              <td className="px-4 py-3 text-center text-green-600 font-medium">{t.best}%</td>
              <td className="px-4 py-3 text-center text-red-500 font-medium">{t.worst}%</td>
              <td className="px-4 py-3 w-32">
                <div className="w-full bg-gray-100 rounded-full h-2">
                  <div className="h-2 rounded-full transition-all"
                    style={{ width: `${t.avg}%`, background: cfg.bar }} />
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
          label={{ value: 'Worksheets', angle: 90, position: 'insideRight', fontSize: 10, fill: 'var(--faint)', offset: 10 }}
        />
        <Tooltip
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null
            const d = payload[0].payload
            return (
              <div className="bg-white border border-gray-200 rounded-lg px-3 py-2 text-xs shadow space-y-0.5">
                <p className="font-semibold text-gray-800 mb-1">{d.fullTopic}</p>
                <p style={{ color: d.fill }}>Avg: <strong>{d.avg}%</strong></p>
                <p className="text-gray-500">Worksheets: <strong>{d.count}</strong></p>
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
          label={{ position: 'top', fontSize: 9, fill: NAV, formatter: (v) => `${v}w` }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  )
}

const MAX_FILE_BYTES = 20 * 1024 * 1024

// "Failed to send a request to the Edge Function" is supabase-js's generic
// wrapper for any fetch()-level failure (dropped connection, DNS hiccup, a
// mobile network handoff mid-upload) — nothing app-specific went wrong, so a
// bare retry after a short pause resolves it far more often than not. Real
// application errors (bad scan, rejected file, etc.) never hit this path.
const MAX_UPLOAD_ATTEMPTS = 3

function AssignmentCard({ a, session, onSubmitted }) {
  const [file, setFile] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [retryAttempt, setRetryAttempt] = useState(0)
  const [error, setError] = useState('')
  // Not status.key !== 'completed' — that flag also flips true the moment a
  // submission/feedback row exists at all, which would make this permanently
  // false (and the "Resubmit" label below unreachable) after a student's
  // very first turn-in. Only a teacher explicitly closing/completing the
  // worksheet should block further submissions.
  const canTurnIn = !a.completed && !a.submissions_closed

  function pickFile(e) {
    const f = e.target.files?.[0] || null
    setError('')
    if (!f) { setFile(null); return }
    if (f.type !== 'application/pdf') { setError('Only PDF files are accepted. Please convert your file to PDF and try again.'); setFile(null); return }
    if (f.size > MAX_FILE_BYTES) { setError('This file is too large. Please upload a file smaller than 20 MB.'); setFile(null); return }
    setFile(f)
  }

  async function submit() {
    if (!file) return
    setUploading(true)
    setError('')

    for (let attempt = 1; attempt <= MAX_UPLOAD_ATTEMPTS; attempt++) {
      setRetryAttempt(attempt)
      const form = new FormData()
      form.append('file', file)
      form.append('assignment_id', a.id)
      form.append('student_id', session.studentId)
      form.append('student_name', session.studentName)
      form.append('class', session.class)
      form.append('portion', a.portion || a.title || '')
      form.append('folder', a.drive_folder_id || '')
      form.append('worksheet', a.link || '')
      form.append('assignment_name', a.title || '')
      form.append('subject', a.subject || '')

      const { data, error: fnErr } = await supabase.functions.invoke('submit-worksheet', { body: form })
      if (!fnErr && data?.ok !== false) {
        setUploading(false)
        setRetryAttempt(0)
        setFile(null)
        onSubmitted()
        return
      }

      // On a non-2xx response supabase-js sets `data` to null and buries the
      // function's actual JSON error body (from submit-worksheet's fail())
      // inside `error.context`, a raw Response — without reading it back out
      // the student only ever sees a generic "non-2xx status code" message.
      let message = data?.error
      if (!message && fnErr?.context?.json) {
        try { message = (await fnErr.context.json())?.error } catch { /* not JSON */ }
      }
      const isNetworkFailure = !message && fnErr?.message?.includes('Failed to send a request')

      if (isNetworkFailure && attempt < MAX_UPLOAD_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, attempt * 1500))
        continue
      }

      setUploading(false)
      setRetryAttempt(0)
      setError(
        isNetworkFailure
          ? 'We could not upload your file due to a connection issue, even after retrying. Please check your internet connection and try again.'
          // The edge function always returns a simple, student-friendly message
          // (see submit-worksheet/index.ts) — fnErr.message is only ever shown
          // here if the function crashed before it could respond at all, so
          // this stays generic rather than surfacing raw technical text.
          : (message || 'Something went wrong while submitting. Please try again, and let your teacher know if it keeps happening.')
      )
      return
    }
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 flex flex-col gap-3 overflow-hidden min-w-0">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${a.subject === 'Science' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>
            {a.subject}
          </span>
          <p className="font-semibold text-gray-800 mt-1.5 truncate">{a.title}</p>
          <p className="text-xs text-gray-400 mt-0.5">Due {formatIST(a.deadline)}</p>
        </div>
        <span className="text-xs font-semibold px-2.5 py-1 rounded-full whitespace-nowrap flex-shrink-0" style={{ background: a.status.bg, color: a.status.color }}>
          {a.status.label}
        </span>
      </div>

      {a.link && (
        <a href={a.link} target="_blank" rel="noreferrer" className="text-xs font-semibold self-start" style={{ color: GOLD }}>
          📄 View worksheet ↗
        </a>
      )}

      {(a.feedback?.handwriting_feedback || a.feedback?.assignment_feedback) && (
        <div className="space-y-1.5">
          {a.feedback.handwriting_feedback && (
            <p className="text-xs text-gray-500">
              <span className="font-semibold text-gray-700">✍️ Handwriting feedback: </span>
              {stripFeedbackContext(a.feedback.handwriting_feedback)}
            </p>
          )}
          {a.feedback.assignment_feedback && (
            <p className="text-xs text-gray-500">
              <span className="font-semibold text-gray-700">📝 Worksheet feedback: </span>
              {stripFeedbackContext(a.feedback.assignment_feedback)}
            </p>
          )}
        </div>
      )}

      {a.submission && (
        <p className="text-xs text-gray-500">
          Submitted <span className="font-medium text-gray-700">{a.submission.file_name}</span> · {formatIST(a.submission.submitted_at)}
        </p>
      )}

      {a.status.key === 'closed' && !a.submission && (
        <p className="text-xs text-gray-400 border-t border-gray-100 pt-3">Your teacher has closed submissions for this worksheet.</p>
      )}

      {canTurnIn && (
        <div className="border-t border-gray-100 pt-3 flex flex-wrap items-center gap-2">
          <label className="text-xs font-medium px-3 py-1.5 rounded-lg border cursor-pointer transition"
            style={{ borderColor: 'rgba(200,134,10,0.35)', color: GOLD, background: 'rgba(200,134,10,0.06)' }}
          >
            {file ? file.name : '📎 Choose PDF'}
            <input type="file" accept="application/pdf" className="hidden" onChange={pickFile} />
          </label>
          <button
            onClick={submit}
            disabled={!file || uploading}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg text-white transition disabled:opacity-40"
            style={{ background: GOLD }}
          >
            {uploading
              ? (retryAttempt > 1 ? `Retrying… (${retryAttempt}/${MAX_UPLOAD_ATTEMPTS})` : 'Uploading…')
              : (a.deadline && new Date(a.deadline) < new Date())
                ? 'Submit late'
                : 'Submit'}
          </button>
        </div>
      )}
      {uploading && retryAttempt > 1 && (
        <p className="text-xs font-medium" style={{ color: '#b45309' }}>
          ⚠️ Connection issue — retrying upload ({retryAttempt}/{MAX_UPLOAD_ATTEMPTS})…
        </p>
      )}
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  )
}

function StatCard({ label, value, sub, type }) {
  const styles = {
    gold:  { accent: '#c8860a',  subColor: '#6b7280' },
    green: { accent: '#22c55e',  subColor: '#6b7280' },
    red:   { accent: '#ef4444',  subColor: '#6b7280' },
    brown: { accent: '#f59e0b',  subColor: '#6b7280' },
    rank:  { accent: '#c8860a',  subColor: '#6b7280' },
  }
  const s = styles[type]
  return (
    <div className="bg-white rounded-xl overflow-hidden shadow-sm border border-gray-100">
      <div className="h-1 w-full" style={{ background: s.accent }} />
      <div className="px-5 py-4">
        <p className="text-[11px] font-semibold uppercase tracking-wider mb-1.5 text-gray-400">{label}</p>
        <p className="text-2xl font-bold leading-tight text-gray-800">{value}</p>
        {sub && <p className="text-xs mt-1.5 text-gray-500">{sub}</p>}
      </div>
    </div>
  )
}
