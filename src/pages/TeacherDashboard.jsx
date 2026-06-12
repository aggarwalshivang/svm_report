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

  useEffect(() => {
    async function load() {
      const [{ data: studs }, { data: scores }] = await Promise.all([
        supabase.from('student_emails').select('*').order('class').order('student_name'),
        supabase.from('student_scores').select('*'),
      ])
      setStudents(studs || [])
      setAllScores(scores || [])
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
    const summaries = students.map((s) => {
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
      return { ...s, totalTests: rows.length, appeared: appeared.length, absentCount, avgPct, sciAvg, mathAvg }
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
      if (a.avgPct === null && b.avgPct === null) return 0
      if (a.avgPct === null) return 1
      if (b.avgPct === null) return -1
      return Number(b.avgPct) - Number(a.avgPct)
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

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#f8f3ed' }}>
        <div className="font-medium" style={{ color: GOLD }}>Loading data…</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen" style={{ background: '#f8f3ed' }}>
      {/* Navbar */}
      <nav className="text-white px-4 py-3 flex items-center justify-between shadow-lg" style={{ background: NAV }}>
        <div className="flex items-center gap-2">
          <span className="font-bold text-base">SVM</span>
          <span className="px-2 py-0.5 rounded-full text-xs font-medium" style={{ background: GOLD }}>
            Teacher
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs hidden sm:block" style={{ color: '#d4b483' }}>{session?.email}</span>
          <button
            onClick={logout}
            className="text-xs px-3 py-1.5 rounded-lg transition font-medium"
            style={{ background: DARK }}
            onMouseEnter={(e) => e.target.style.background = GOLD}
            onMouseLeave={(e) => e.target.style.background = DARK}
          >
            Logout
          </button>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto p-3 sm:p-6 space-y-4">
        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="Total Students" value={scope.length} type="gold" />
          <StatCard label="Class Average" value={classAvg !== 'N/A' ? `${classAvg}%` : 'N/A'} type="green" />
          <StatCard label="Class 9 Students" value={studentSummary.filter((s) => s.class === 9).length} type="brown" />
          <StatCard label="Class 10 Students" value={studentSummary.filter((s) => s.class === 10).length} type="brown2" />
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-2 items-center">
          {/* View toggle */}
          <div className="flex bg-white rounded-lg border p-1 gap-1">
            {[{ k: 'students', label: '👥 Students' }, { k: 'analysis', label: '📊 Analysis' }, { k: 'tests', label: '📋 Tests' }].map(({ k, label }) => (
              <button key={k} onClick={() => setView(k)}
                className="px-3 py-1.5 rounded-md text-sm font-medium transition"
                style={view === k ? { background: NAV, color: GOLD } : { color: '#6b4c1e' }}
              >{label}</button>
            ))}
          </div>
          {/* Class filter */}
          <div className="flex bg-white rounded-lg border p-1 gap-1">
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
          {view === 'students' && (
            <input
              type="text"
              placeholder="Search student…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="border rounded-lg px-4 py-2 text-sm focus:outline-none bg-white"
              onFocus={(e) => e.target.style.boxShadow = `0 0 0 2px ${GOLD}40`}
              onBlur={(e) => e.target.style.boxShadow = ''}
            />
          )}
          <span className="text-sm text-gray-400 ml-auto">
            {view === 'students' ? `${filtered.length} students` : `${filteredTests.length} tests`}
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
                        <p className="text-sm font-semibold" style={{ color }}>{label} — Chapter Analysis</p>
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

              {/* Strong / Moderate / Weak tables */}
              {[
                { label: '🏆 Strong Chapters', data: strongChapters,   type: 'strong',   empty: 'No chapters above 80% yet.' },
                { label: '🟡 Moderate Chapters', data: moderateChapters, type: 'moderate', empty: 'No moderate chapters.' },
                { label: '⚠️ Weak Chapters',   data: weakChapters,     type: 'weak',     empty: 'No weak chapters — great work!' },
              ].map(({ label, data, type, empty }) => (
                <div key={type} className="bg-white rounded-xl shadow overflow-hidden">
                  <div className="px-5 py-3 border-b" style={{ background: type === 'strong' ? '#f0fdf4' : type === 'moderate' ? '#fffbeb' : '#fef2f2' }}>
                    <p className="text-sm font-semibold" style={{ color: type === 'strong' ? '#166534' : type === 'moderate' ? '#92400e' : '#991b1b' }}>{label} ({data.length})</p>
                  </div>
                  {data.length === 0
                    ? <p className="text-sm text-gray-400 py-6 text-center">{empty}</p>
                    : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-left text-xs text-gray-500 uppercase" style={{ background: type === 'strong' ? '#f0fdf4' : type === 'moderate' ? '#fffbeb' : '#fef2f2' }}>
                              <th className="px-5 py-2">Chapter / Topic</th>
                              <th className="px-5 py-2">Subject</th>
                              <th className="px-5 py-2 text-center">Tests</th>
                              <th className="px-5 py-2 text-center">Class Avg %</th>
                              <th className="px-5 py-2 text-center">Best</th>
                              <th className="px-5 py-2 text-center">Worst</th>
                              <th className="px-5 py-2">Progress</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-50">
                            {data.map((t) => {
                              const barColor = type === 'strong' ? '#16a34a' : type === 'moderate' ? '#c8860a' : '#ef4444'
                              const textColor = type === 'strong' ? 'text-green-700' : type === 'moderate' ? 'text-amber-600' : 'text-red-600'
                              return (
                                <tr key={`${t.subject}-${t.topic}`} className={type === 'strong' ? 'hover:bg-green-50' : type === 'moderate' ? 'hover:bg-amber-50' : 'hover:bg-red-50'}>
                                  <td className="px-5 py-2 font-medium text-gray-800 text-xs">{t.topic}</td>
                                  <td className="px-5 py-2">
                                    <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${t.subject === 'Science' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>{t.subject}</span>
                                  </td>
                                  <td className="px-5 py-2 text-center text-gray-600 text-xs">{t.testCount}</td>
                                  <td className="px-5 py-2 text-center"><span className={`font-bold text-sm ${textColor}`}>{t.avg}%</span></td>
                                  <td className="px-5 py-2 text-center text-green-600 font-medium text-xs">{t.best}%</td>
                                  <td className="px-5 py-2 text-center text-red-500 font-medium text-xs">{t.worst}%</td>
                                  <td className="px-5 py-2 w-28">
                                    <div className="w-full bg-gray-100 rounded-full h-1.5">
                                      <div className="h-1.5 rounded-full" style={{ width: `${t.avg}%`, background: barColor }} />
                                    </div>
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    )
                  }
                </div>
              ))}
            </div>
          )
        })()}

        {/* Tests table */}
        {view === 'tests' && (
          <div className="bg-white rounded-xl shadow overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-500 uppercase tracking-wide" style={{ background: '#fdf6ee' }}>
                    <th className="px-4 py-3 text-center">#</th>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Subject</th>
                    <th className="px-4 py-3">Chapter / Topic</th>
                    <th className="px-4 py-3 text-center">Class</th>
                    <th className="px-4 py-3 text-center">Total</th>
                    <th className="px-4 py-3 text-center">Students</th>
                    <th className="px-4 py-3 text-center">Top ≥70%</th>
                    <th className="px-4 py-3 text-center">Send</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filteredTests.map((t) => {
                    const appeared = t.scores.filter((s) => !s.is_absent)
                    const topCount = appeared.filter((s) => s.score_obtained / t.total_marks >= 0.7).length
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
                        <td className="px-4 py-3 text-center text-gray-600 text-xs">{appeared.length}/{t.scores.length}</td>
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
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 uppercase tracking-wide" style={{ background: '#fdf6ee' }}>
                  <th className="px-3 sm:px-5 py-3">Student</th>
                  <th className="px-3 sm:px-5 py-3 text-center">Class</th>
                  <th className="px-3 sm:px-5 py-3 text-center">Rank</th>
                  <th className="px-3 sm:px-5 py-3 text-center hidden sm:table-cell">Tests</th>
                  <th className="px-3 sm:px-5 py-3 text-center">Avg %</th>
                  <th className="px-3 sm:px-5 py-3 text-center hidden md:table-cell">Science</th>
                  <th className="px-3 sm:px-5 py-3 text-center hidden md:table-cell">Maths</th>
                  <th className="px-3 sm:px-5 py-3 text-center hidden sm:table-cell">Absent</th>
                  <th className="px-3 sm:px-5 py-3 text-center hidden sm:table-cell">Detail</th>
                </tr>
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
    gold:   { background: '#fef3d0', color: '#7a5100', border: '1px solid #f0d080' },
    green:  { background: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0' },
    brown:  { background: '#fdf6ee', color: '#6b4c1e', border: '1px solid #e8d5b0' },
    brown2: { background: '#faf0e6', color: '#5c3d15', border: '1px solid #ddc99a' },
  }
  return (
    <div className="rounded-xl p-5" style={styles[type]}>
      <p className="text-xs font-medium opacity-70 mb-1">{label}</p>
      <p className="text-2xl font-bold">{value}</p>
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
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0ebe4" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={48} interval="preserveStartEnd" />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} unit="%" />
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
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0ebe4" />
                  <XAxis dataKey="subject" tick={{ fontSize: 11 }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} unit="%" />
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
                <div className="px-4 py-2.5 flex flex-wrap items-center gap-2 border-b border-gray-100" style={{ background: '#fdfaf6' }}>
                  <div className="flex gap-1">
                    {['All', 'Science', 'Maths'].map((f) => (
                      <button key={f} onClick={() => setSubjectFilter(f)}
                        className="px-2.5 py-1 rounded-full text-xs font-medium transition"
                        style={subjectFilter === f ? { background: GOLD, color: 'white' } : { background: '#f5ede0', color: '#6b4c1e' }}
                      >{f}</button>
                    ))}
                  </div>
                  <div className="w-px h-4 bg-gray-200" />
                  <div className="flex items-center gap-1 flex-wrap">
                    <span className="text-[10px] text-gray-400">Sort:</span>
                    {[
                      { key: 'date-desc', label: 'Date ↓' },
                      { key: 'date-asc',  label: 'Date ↑' },
                      { key: 'pct-desc',  label: '% ↓' },
                      { key: 'pct-asc',   label: '% ↑' },
                      { key: 'subject',   label: 'Subject' },
                    ].map(({ key, label }) => (
                      <button key={key} onClick={() => setSortBy(key)}
                        className="px-2 py-0.5 rounded text-[10px] font-medium transition"
                        style={sortBy === key ? { background: NAV, color: GOLD } : { background: '#f0ebe4', color: '#6b4c1e' }}
                      >{label}</button>
                    ))}
                  </div>
                  <span className="ml-auto text-[10px] text-gray-400">{displayed.length} tests</span>
                </div>

                {/* Scrollable table */}
                <div className="overflow-x-auto">
                  <div className="overflow-y-auto" style={{ maxHeight: '340px' }}>
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 z-10">
                        <tr className="text-xs text-gray-500 uppercase" style={{ background: '#fdf6ee' }}>
                          <th className="px-4 py-2 text-left cursor-pointer hover:text-amber-700 select-none"
                            onClick={() => setSortBy(sortBy === 'date-desc' ? 'date-asc' : 'date-desc')}>
                            Date {sortBy === 'date-desc' ? '↓' : sortBy === 'date-asc' ? '↑' : ''}
                          </th>
                          <th className="px-4 py-2 text-left cursor-pointer hover:text-amber-700 select-none"
                            onClick={() => setSortBy('subject')}>
                            Subject {sortBy === 'subject' ? '↓' : ''}
                          </th>
                          <th className="px-4 py-2 text-left">Topic</th>
                          <th className="px-4 py-2 text-center">Score</th>
                          <th className="px-4 py-2 text-center">Total</th>
                          <th className="px-4 py-2 text-center cursor-pointer hover:text-amber-700 select-none"
                            onClick={() => setSortBy(sortBy === 'pct-desc' ? 'pct-asc' : 'pct-desc')}>
                            % {sortBy === 'pct-desc' ? '↓' : sortBy === 'pct-asc' ? '↑' : ''}
                          </th>
                          <th className="px-4 py-2 text-center hidden sm:table-cell">Δ</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {displayed.map((s) => {
                          const pct   = s.is_absent ? null : +((s.score_obtained / s.total_marks) * 100).toFixed(1)
                          const delta = s.is_absent ? null : deltaMap[s.id]
                          return (
                            <tr key={s.id} className="hover:bg-amber-50">
                              <td className="px-4 py-2 text-gray-500 text-xs">{s.date}</td>
                              <td className="px-4 py-2">
                                <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${s.subject === 'Science' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>{s.subject}</span>
                              </td>
                              <td className="px-4 py-2 text-gray-600 max-w-[180px] truncate text-xs">{s.topic_name}</td>
                              <td className="px-4 py-2 text-center font-medium text-sm">
                                {s.is_absent ? <span className="text-red-400 text-xs">Absent</span> : s.score_obtained}
                              </td>
                              <td className="px-4 py-2 text-center text-gray-400">{s.total_marks}</td>
                              <td className="px-4 py-2 text-center">
                                {pct !== null
                                  ? <span className={`font-bold text-xs ${pct >= 80 ? 'text-green-600' : pct >= 60 ? 'text-amber-600' : 'text-red-500'}`}>{pct}%</span>
                                  : '—'}
                              </td>
                              <td className="px-4 py-2 text-center hidden sm:table-cell">
                                <DeltaBadge delta={delta} />
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
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
  if (delta === null || delta === undefined) return <span className="text-gray-300 text-xs">—</span>
  if (delta === 0) return <span className="text-xs text-gray-400">±0</span>
  const positive = delta > 0
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-semibold px-1.5 py-0.5 rounded ${
      positive ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'
    }`}>
      {positive ? '▲' : '▼'} {positive ? '+' : ''}{delta}%
    </span>
  )
}

function ModalTopicTable({ topics, type }) {
  const cfg = {
    strong:   { border: '#bbf7d0', bg: '#f0fdf4', hover: 'hover:bg-green-50',  color: 'text-green-700',  bar: '#16a34a' },
    moderate: { border: '#fde68a', bg: '#fffbeb', hover: 'hover:bg-amber-50',  color: 'text-amber-600',  bar: '#c8860a' },
    weak:     { border: '#fecaca', bg: '#fef2f2', hover: 'hover:bg-red-50',    color: 'text-red-600',    bar: '#ef4444' },
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
        <CartesianGrid strokeDasharray="3 3" stroke="#f0ebe4" />
        <XAxis
          dataKey="topic"
          tick={{ fontSize: 10 }}
          angle={-35}
          textAnchor="end"
          interval={0}
          height={70}
        />
        <YAxis
          yAxisId="pct"
          domain={[0, 100]}
          tick={{ fontSize: 10 }}
          unit="%"
          label={{ value: 'Avg %', angle: -90, position: 'insideLeft', fontSize: 10, fill: '#9ca3af', offset: 10 }}
        />
        <YAxis
          yAxisId="cnt"
          orientation="right"
          domain={[0, maxCount + 1]}
          tick={{ fontSize: 10 }}
          allowDecimals={false}
          label={{ value: 'Tests', angle: 90, position: 'insideRight', fontSize: 10, fill: '#9ca3af', offset: 10 }}
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
          label={{ position: 'top', fontSize: 9, fill: '#6b7280', formatter: (v) => `${v}%` }}
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
  let style = { background: '#fdf6ee' }
  let labelColor = '#6b7280'
  let valueColor = NAV
  if (highlight) { style = { background: DARK, border: `1px solid ${GOLD}` }; labelColor = '#e0a030'; valueColor = GOLD }
  if (positive)  { style = { background: '#f0fdf4', border: '1px solid #bbf7d0' }; labelColor = '#166534'; valueColor = '#16a34a' }
  if (negative)  { style = { background: '#fef2f2', border: '1px solid #fecaca' }; labelColor = '#991b1b'; valueColor = '#ef4444' }
  return (
    <div className="rounded-lg p-3 text-center" style={style}>
      <p className="text-xs mb-1" style={{ color: labelColor }}>{label}</p>
      <p className="text-lg font-bold" style={{ color: valueColor }}>{value}</p>
    </div>
  )
}
