import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ComposedChart, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer, LineChart, Line, Cell, Legend,
} from 'recharts'
import { supabase } from '../lib/supabase'

const GOLD = '#c8860a'
const NAV  = '#2d1200'
const DARK = '#1a0800'

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

  // Chapter analysis sort + filter state
  const [chapterSort, setChapterSort] = useState({ col: 'avg', dir: 'desc' })
  const [chapterSubject, setChapterSubject] = useState('All')

  // Manage tab state
  const [manageMode, setManageMode] = useState('list') // 'list' | 'add'
  const [newStudent, setNewStudent] = useState({ name: '', class: '9', emails: [''] })
  const [savingStudent, setSavingStudent] = useState(false)
  const [deletingStudentId, setDeletingStudentId] = useState(null)
  const [expandedStudent, setExpandedStudent] = useState(null)
  const [pendingEmail, setPendingEmail] = useState('')
  const [savingEmail, setSavingEmail] = useState(false)
  const [deletingEmailId, setDeletingEmailId] = useState(null)

  useEffect(() => {
    async function load() {
      const [{ data: studs }] = await Promise.all([
        supabase.from('student_emails').select('*').order('class').order('student_name'),
      ])
      setStudents(studs || [])

      // Supabase caps at 1000 rows by default — page through all score records
      const PAGE = 1000
      let allRows = []
      let from = 0
      while (true) {
        const { data, error } = await supabase
          .from('student_scores')
          .select('*')
          .range(from, from + PAGE - 1)
        if (error || !data || data.length === 0) break
        allRows = allRows.concat(data)
        if (data.length < PAGE) break
        from += PAGE
      }
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
      const rows = allScores.filter((r) => r.student_id === s.student_id)
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
    const scopeIds = new Set(scope.map((s) => s.student_id))
    const map = {}
    allScores.forEach((r) => {
      if (!scopeIds.has(r.student_id) || r.is_absent) return
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
      if (!student) return
      const key = `${score.date}|${score.subject}|${score.topic_name}|${score.total_marks}|${student.class}`
      if (!map[key]) map[key] = { key, date: score.date, subject: score.subject, topic: score.topic_name, total_marks: score.total_marks, class: student.class, scores: [] }
      map[key].scores.push({ ...score, student_name: student.student_name })
    })
    return Object.values(map)
      .sort((a, b) => a.date.localeCompare(b.date) || a.subject.localeCompare(b.subject))
      .map((t, i) => ({ ...t, testNo: i + 1 }))
  }, [allScores, students])

  const filteredTests = uniqueTests.filter((t) => classFilter === 'All' || String(t.class) === classFilter)

  const sortedTests = [...filteredTests]
    .map((t) => {
      const appeared = t.scores.filter((s) => !s.is_absent)
      return { ...t, appearedCount: appeared.length, topCount70: appeared.filter((s) => s.score_obtained / t.total_marks >= 0.7).length }
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
      if (!map[row.student_id]) map[row.student_id] = { student_id: row.student_id, student_name: row.student_name, class: row.class, emails: [] }
      if (row.email) map[row.student_id].emails.push({ id: row.id, email: row.email })
    })
    return Object.values(map).sort((a, b) => Number(a.class) - Number(b.class) || a.student_name.localeCompare(b.student_name))
  }, [students])

  function generateMessage(test) {
    const d = new Date(test.date + 'T00:00:00')
    const dateStr = d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })
    const topScorers = test.scores
      .filter((s) => !s.is_absent && s.score_obtained / test.total_marks >= 0.7)
      .sort((a, b) => b.score_obtained - a.score_obtained || a.student_name.localeCompare(b.student_name))
    let rank = 1
    const ranked = topScorers.map((s, i) => {
      if (i > 0 && s.score_obtained < topScorers[i - 1].score_obtained) rank = i + 1
      return { ...s, rank }
    })
    const list = ranked.length
      ? ranked.map((s) => `${s.rank}. ${s.student_name} - ${s.score_obtained}/${test.total_marks}`).join('\n')
      : '_(No students scored ≥70%)_'
    return `✅ *Practice Test #${test.testNo} Scores – ${dateStr}*\n\nThe scores have been sent individually to parents via personal *WhatsApp*.\n\n🏆 *Only the Top Scorers are shared in the group.*\n\n📚 *${test.subject} - ${test.topic}*\n📊 *Total Marks:* ${test.total_marks}\n\n*Top Performers (≥70%):*\n\n${list}\n\n📞 *For any queries, please contact 999-266-1556.*\n\n🙏 Thank you for your support!\n\n*Saraswati Vidyamandir*`
  }

  async function sendReport(test) {
    setSending(test.key)
    setSendResult(null)
    try {
      const res = await fetch('https://n8n.saraswatividyamandir.com/webhook/svm-top-scorer-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: generateMessage(test), class: String(test.class) }),
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

  async function addStudent() {
    const validEmails = newStudent.emails.filter((e) => e.trim())
    if (!newStudent.name.trim() || !validEmails.length) return
    setSavingStudent(true)
    const maxId = students.length ? Math.max(...students.map((s) => Number(s.student_id))) : 0
    const newId = maxId + 1
    const rows = validEmails.map((email) => ({
      student_id: newId,
      student_name: newStudent.name.trim(),
      class: Number(newStudent.class),
      email: email.trim().toLowerCase(),
    }))
    const { data, error } = await supabase.from('student_emails').insert(rows).select()
    if (!error && data) {
      setStudents((prev) => [...prev, ...data])
      setNewStudent({ name: '', class: '9', emails: [''] })
      setManageMode('list')
    }
    setSavingStudent(false)
  }

  async function deleteStudent(studentId) {
    if (!window.confirm('Remove this student and all their scores? This cannot be undone.')) return
    setDeletingStudentId(studentId)
    // Delete child rows (student_scores) before the parent (student_emails) — deleting
    // them concurrently can race a foreign-key constraint and silently fail the parent delete.
    const { error: scoresErr } = await supabase.from('student_scores').delete().eq('student_id', studentId)
    if (scoresErr) {
      alert(`Failed to remove student's scores: ${scoresErr.message}`)
      setDeletingStudentId(null)
      return
    }
    const { error: emailsErr } = await supabase.from('student_emails').delete().eq('student_id', studentId)
    if (emailsErr) {
      alert(`Failed to remove student: ${emailsErr.message}`)
      setDeletingStudentId(null)
      return
    }
    setStudents((prev) => prev.filter((s) => s.student_id !== studentId))
    setAllScores((prev) => prev.filter((s) => s.student_id !== studentId))
    if (expandedStudent === studentId) setExpandedStudent(null)
    setDeletingStudentId(null)
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
    }]).select()
    if (!error && data) { setStudents((prev) => [...prev, ...data]); setPendingEmail('') }
    setSavingEmail(false)
  }

  async function removeEmail(emailRow) {
    setDeletingEmailId(emailRow.id)
    const { error } = await supabase.from('student_emails').delete().eq('id', emailRow.id)
    if (!error) setStudents((prev) => prev.filter((s) => s.id !== emailRow.id))
    setDeletingEmailId(null)
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#1a0800' }}>
        <div className="text-center">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: NAV }}>
            <span className="text-lg font-black" style={{ color: GOLD }}>S</span>
          </div>
          <p className="font-semibold text-sm" style={{ color: GOLD }}>Loading data…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen dark-theme" style={{ background: '#1a0800' }}>
      {/* Navbar */}
      <nav className="text-white px-5 py-3 flex items-center justify-between" style={{ background: NAV, borderBottom: '2px solid rgba(200,134,10,0.35)', boxShadow: '0 4px 16px rgba(0,0,0,0.2)' }}>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: GOLD }}>
            <span className="text-lg font-black text-white">S</span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm hidden sm:block">Saraswati VidyaMandir</span>
              <span className="font-bold text-sm sm:hidden">SVM</span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold" style={{ background: 'rgba(200,134,10,0.2)', color: GOLD, border: `1px solid rgba(200,134,10,0.5)` }}>Teacher</span>
            </div>
            <p className="text-[10px] hidden sm:block mt-0.5" style={{ color: '#9a7040' }}>Student Report Portal</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs hidden sm:block" style={{ color: '#9a7040' }}>{session?.email}</span>
          <button
            onClick={logout}
            className="text-xs px-3 py-1.5 rounded-lg transition font-medium border"
            style={{ background: 'transparent', borderColor: 'rgba(255,255,255,0.2)', color: '#d4b483' }}
            onMouseEnter={(e) => { e.currentTarget.style.background = GOLD; e.currentTarget.style.borderColor = GOLD; e.currentTarget.style.color = 'white' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)'; e.currentTarget.style.color = '#d4b483' }}
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
            <div className="rounded-xl border overflow-hidden flex md:flex-col" style={{ background: '#2d1200', borderColor: 'rgba(200,134,10,0.2)' }}>
              {[
                { k: 'students', label: 'Students', icon: '👥' },
                { k: 'analysis', label: 'Analysis', icon: '📊' },
                { k: 'tests',    label: 'Tests',    icon: '📋' },
                { k: 'toppers',  label: 'Toppers',  icon: '🏆' },
                { k: 'manage',   label: 'Other',    icon: '⚙️' },
              ].map(({ k, label, icon }) => (
                <button
                  key={k}
                  onClick={() => setView(k)}
                  className="flex-1 md:flex-none flex items-center justify-center md:justify-start gap-3 px-3 md:px-5 py-3 md:py-4 text-xs md:text-sm font-semibold transition-all border-b md:border-b-0 md:border-l-[3px] last:border-b-0"
                  style={view === k
                    ? { borderColor: GOLD, color: GOLD, background: 'rgba(200,134,10,0.12)' }
                    : { borderColor: 'rgba(200,134,10,0.1)', color: '#7a5030' }
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
              <div className="flex bg-gray-50 rounded-lg border border-gray-200 p-1 gap-1">
                {['All', '9', '10'].map((c) => (
                  <button
                    key={c}
                    onClick={() => setClassFilter(c)}
                    className="px-4 py-1.5 rounded-md text-sm font-medium transition"
                    style={classFilter === c ? { background: GOLD, color: 'white' } : { color: '#6b4c1e' }}
                  >
                    {c === 'All' ? 'All Classes' : `Class ${c}`}
                  </button>
                ))}
              </div>
              {(view === 'students' || view === 'manage') && (
                <input
                  type="text"
                  placeholder="Search student…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="border border-gray-200 rounded-lg px-4 py-2 text-sm focus:outline-none bg-gray-50"
                  onFocus={(e) => e.target.style.boxShadow = `0 0 0 2px ${GOLD}40`}
                  onBlur={(e) => e.target.style.boxShadow = ''}
                />
              )}
              <span className="text-sm text-gray-400 ml-auto">
                {view === 'students' ? `${filtered.length} students` : view === 'tests' ? `${filteredTests.length} tests` : view === 'manage' ? `${studentList.length} students` : ''}
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
                        : { background: 'rgba(200,134,10,0.1)', color: '#9a7040' }
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
                  <span style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '3px', color: '#9a7040', textTransform: 'uppercase' }}>Class</span>
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
                        <div style={{ color: '#f5ede0', fontWeight: 700, fontSize: '11px', textAlign: 'center', lineHeight: '1.3', marginBottom: '4px', wordBreak: 'break-word' }}>
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
                    <span style={{ color: '#9a7040', fontWeight: 700, fontSize: '11px', width: '22px', flexShrink: 0 }}>#{i + 4}</span>
                    <div style={{
                      width: '30px', height: '30px', borderRadius: '50%',
                      background: GOLD, color: '#fff', fontWeight: 900, fontSize: '11px',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    }}>{ini(s.student_name)}</div>
                    <span style={{ color: '#f5ede0', fontWeight: 600, fontSize: '13px', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {s.student_name}
                    </span>
                    <span style={{ color: Number(s.avgPct) >= 80 ? '#4ade80' : Number(s.avgPct) >= 60 ? GOLD : '#f87171', fontWeight: 700, fontSize: '13px', flexShrink: 0 }}>
                      {s.avgPct}%
                    </span>
                  </div>
                ))}

                {students.length === 0 && (
                  <div style={{ textAlign: 'center', padding: '32px 0', color: '#9a7040', fontSize: '13px' }}>No data yet</div>
                )}
              </div>
            )
          }

          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <span style={{ fontSize: '11px', fontWeight: 700, color: '#9a7040', textTransform: 'uppercase', letterSpacing: '1px' }}>
                  Ranked by overall average · min. 1 test
                </span>
              </div>

              <div style={{
                background: '#1a0800',
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
                      Saraswati VidyaMandir
                    </span>
                  </div>
                  <div style={{ color: '#7a5030', fontSize: '12px', marginTop: '4px' }}>Top Performers — All Time</div>
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
            <div className="overflow-x-auto">
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
                        className={`px-4 py-3 cursor-pointer select-none hover:text-amber-400 transition-colors ${className}`}
                        onClick={() => toggleTestSort(col)}
                      >
                        {children}<SI col={col} />
                      </th>
                    )
                    return (
                      <tr className="text-left text-xs text-gray-500 uppercase tracking-wide" style={{ background: '#120600' }}>
                        <TH col="testNo" className="text-center">#</TH>
                        <TH col="date">Date</TH>
                        <TH col="subject">Subject</TH>
                        <TH col="topic">Chapter / Topic</TH>
                        <TH col="class" className="text-center">Class</TH>
                        <TH col="total_marks" className="text-center">Total</TH>
                        <TH col="appearedCount" className="text-center">Students</TH>
                        <TH col="topCount70" className="text-center">Top ≥70%</TH>
                        <th className="px-4 py-3 text-center">Send</th>
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
                        <td className="px-4 py-3 text-center font-bold text-gray-400 text-xs">#{t.testNo}</td>
                        <td className="px-4 py-3 text-gray-600 text-xs">{t.date}</td>
                        <td className="px-4 py-3">
                          <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${t.subject === 'Science' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>{t.subject}</span>
                        </td>
                        <td className="px-4 py-3 text-gray-700 text-xs max-w-[200px] truncate">{t.topic}</td>
                        <td className="px-4 py-3 text-center">
                          <span className="px-2 py-0.5 rounded-full text-xs font-bold text-white" style={{ background: GOLD }}>{t.class}</span>
                        </td>
                        <td className="px-4 py-3 text-center font-medium text-gray-700">{t.total_marks}</td>
                        <td className="px-4 py-3 text-center text-gray-600 text-xs">{appearedCount}/{t.scores.length}</td>
                        <td className="px-4 py-3 text-center">
                          <span className={`font-semibold text-xs ${topCount > 0 ? 'text-green-600' : 'text-gray-400'}`}>{topCount}</span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          {isSending ? (
                            <span className="text-xs text-amber-600 font-medium">Sending…</span>
                          ) : result && !result.success ? (
                            <div className="flex flex-col items-center gap-1">
                              <span className="text-xs text-red-500 font-medium">✗ Failed</span>
                              <button onClick={() => sendReport(t)} className="text-xs font-medium" style={{ color: GOLD }}>Retry</button>
                            </div>
                          ) : sentReports[t.key] ? (
                            <div className="flex flex-col items-center gap-1">
                              <span className="text-xs text-green-600 font-semibold">✓ Sent</span>
                              <span className="text-[10px] text-gray-400">{new Date(sentReports[t.key]).toLocaleDateString('en-US', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                              <button onClick={() => sendReport(t)} className="text-[10px] font-medium px-2 py-0.5 rounded border" style={{ color: GOLD, borderColor: GOLD }}>↺ Re-send</button>
                            </div>
                          ) : (
                            <button
                              onClick={() => sendReport(t)}
                              className="text-xs font-semibold px-3 py-1.5 rounded-lg text-white transition"
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
                    <tr className="text-left text-xs text-gray-500 uppercase tracking-wide" style={{ background: '#120600' }}>
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
                            : <span className="text-xs" style={{ color: '#9a7040' }}>—</span>
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
                <div className="px-5 py-4 border-b flex items-center justify-between" style={{ background: '#120600' }}>
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
                <div className="px-5 py-2 flex items-center gap-3 text-[10px] font-bold uppercase tracking-wider text-gray-400 border-b" style={{ background: '#150700' }}>
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
                          <div className="w-16 flex items-center justify-end gap-2 flex-shrink-0">
                            <button
                              onClick={(e) => { e.stopPropagation(); deleteStudent(s.student_id) }}
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
                            <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-2">Linked Emails</p>
                            <div className="space-y-1.5 mb-3">
                              {s.emails.map((emailRow) => (
                                <div key={emailRow.id} className="flex items-center justify-between gap-2 bg-white rounded-lg px-3 py-2 border border-gray-100">
                                  <span className="text-sm text-gray-700">{emailRow.email}</span>
                                  {s.emails.length > 1 ? (
                                    <button
                                      onClick={() => removeEmail(emailRow)}
                                      disabled={deletingEmailId === emailRow.id}
                                      className="text-xs text-red-400 hover:text-red-600 font-semibold flex-shrink-0 disabled:opacity-50"
                                    >
                                      {deletingEmailId === emailRow.id ? '…' : 'Remove'}
                                    </button>
                                  ) : (
                                    <span className="text-[10px] text-gray-300">primary</span>
                                  )}
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
                <div className="px-5 py-4 border-b" style={{ background: '#120600' }}>
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
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">Class</label>
                    <div className="flex gap-2">
                      {['9', '10'].map((c) => (
                        <button
                          key={c}
                          onClick={() => setNewStudent((p) => ({ ...p, class: c }))}
                          className="px-8 py-2.5 rounded-lg text-sm font-semibold transition"
                          style={newStudent.class === c ? { background: GOLD, color: 'white' } : { background: '#f5ede0', color: '#6b4c1e' }}
                        >
                          Class {c}
                        </button>
                      ))}
                    </div>
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
                      disabled={savingStudent || !newStudent.name.trim() || !newStudent.emails.some((e) => e.trim())}
                      className="px-6 py-2.5 rounded-lg text-sm font-semibold text-white transition disabled:opacity-50"
                      style={{ background: GOLD }}
                    >
                      {savingStudent ? 'Saving…' : 'Add Student'}
                    </button>
                    <button
                      onClick={() => { setManageMode('list'); setNewStudent({ name: '', class: '9', emails: [''] }) }}
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
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#9a7040' }} minTickGap={48} interval="preserveStartEnd" />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: '#9a7040' }} unit="%" />
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
                  <XAxis dataKey="subject" tick={{ fontSize: 11, fill: '#9a7040' }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: '#9a7040' }} unit="%" />
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
                  className="flex items-center gap-1.5 px-3 sm:px-4 py-2.5 text-xs font-medium transition border-b-2 -mb-px whitespace-nowrap flex-shrink-0"
                  style={tab === key ? { borderColor: GOLD, color: GOLD } : { borderColor: 'transparent', color: '#6b7280' }}
                >
                  {label}
                  <span className="rounded-full px-1.5 py-0.5 font-bold text-[10px]"
                    style={tab === key ? { background: GOLD, color: 'white' } : { background: '#f3f4f6', color: '#6b7280' }}>
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
                          : { background: 'rgba(200,134,10,0.12)', color: '#9a7040', border: '1px solid rgba(200,134,10,0.25)' }}
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
                          : { background: 'rgba(200,134,10,0.06)', color: '#9a7040', border: '1px solid rgba(200,134,10,0.2)' }}
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
      background: 'rgba(200,134,10,0.1)', color: '#9a7040',
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

function ModalTopicTable({ topics, type }) {
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
            <th className="px-4 py-2 text-center">Tests</th>
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
          tick={{ fontSize: 10, fill: '#9a7040' }}
          angle={-35}
          textAnchor="end"
          interval={0}
          height={70}
        />
        <YAxis
          yAxisId="pct"
          domain={[0, 100]}
          tick={{ fontSize: 10, fill: '#9a7040' }}
          unit="%"
          label={{ value: 'Avg %', angle: -90, position: 'insideLeft', fontSize: 10, fill: '#9a7040', offset: 10 }}
        />
        <YAxis
          yAxisId="cnt"
          orientation="right"
          domain={[0, maxCount + 1]}
          tick={{ fontSize: 10, fill: '#9a7040' }}
          allowDecimals={false}
          label={{ value: 'Tests', angle: 90, position: 'insideRight', fontSize: 10, fill: '#9a7040', offset: 10 }}
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
          label={{ position: 'top', fontSize: 9, fill: '#9a7040', formatter: (v) => `${v}%` }}
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
