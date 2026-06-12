import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LineChart, Line,
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

  function logout() {
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

  const filtered = studentSummary.filter((s) => {
    if (classFilter !== 'All' && String(s.class) !== classFilter) return false
    if (search && !s.student_name.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const scope = classFilter === 'All' ? studentSummary : studentSummary.filter((s) => String(s.class) === classFilter)
  const withData = scope.filter((s) => s.avgPct !== null)
  const classAvg = withData.length
    ? (withData.reduce((a, s) => a + Number(s.avgPct), 0) / withData.length).toFixed(1)
    : 'N/A'

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
          <div className="flex bg-white rounded-lg border p-1 gap-1">
            {['All', '9', '10'].map((c) => (
              <button
                key={c}
                onClick={() => setClassFilter(c)}
                className="px-4 py-1.5 rounded-md text-sm font-medium transition"
                style={classFilter === c
                  ? { background: GOLD, color: 'white' }
                  : { color: '#6b4c1e' }
                }
              >
                {c === 'All' ? 'All Classes' : `Class ${c}`}
              </button>
            ))}
          </div>
          <input
            type="text"
            placeholder="Search student…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="border rounded-lg px-4 py-2 text-sm focus:outline-none bg-white"
            onFocus={(e) => e.target.style.boxShadow = `0 0 0 2px ${GOLD}40`}
            onBlur={(e) => e.target.style.boxShadow = ''}
          />
          <span className="text-sm text-gray-400 ml-auto">{filtered.length} students</span>
        </div>

        {/* Student table */}
        <div className="bg-white rounded-xl shadow overflow-hidden">
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
        </div>
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
  const topicStats   = Object.values(topicMap).map((t) => ({ ...t, avg: +(t.total / t.count).toFixed(1), best: +t.best.toFixed(1), worst: +t.worst.toFixed(1) }))
  const strongTopics = topicStats.filter((t) => t.avg >= 80).sort((a, b) => b.avg - a.avg)
  const weakTopics   = topicStats.filter((t) => t.avg <  80).sort((a, b) => a.avg - b.avg)

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
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            <MiniStat label="Tests Taken"  value={`${student.appeared}/${student.totalTests}`} />
            <MiniStat label="Overall Avg"  value={student.avgPct ? `${student.avgPct}%` : '—'} />
            <MiniStat label="Science Avg"  value={student.sciAvg  ? `${student.sciAvg}%`  : '—'} />
            <MiniStat label="Maths Avg"    value={student.mathAvg ? `${student.mathAvg}%` : '—'} />
            <MiniStat
              label="Class Rank"
              value={student.rank ? `#${student.rank}` : '—'}
              highlight
            />
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
                  <Tooltip formatter={(v) => `${v}%`} />
                  <Line type="monotone" dataKey="pct" stroke={GOLD} dot={{ r: 3, fill: GOLD }} strokeWidth={2} />
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
                { key: 'all',    label: '📋 All Tests',      count: scores.length },
                { key: 'strong', label: '🏆 Strong (≥80%)', count: strongTopics.length },
                { key: 'weak',   label: '⚠️ Weak (<80%)',   count: weakTopics.length },
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
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {displayed.map((s) => {
                          const pct = s.is_absent ? null : ((s.score_obtained / s.total_marks) * 100).toFixed(1)
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
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}

            {/* Strong Topics */}
            {tab === 'strong' && (
              <div className="p-4">
                {strongTopics.length === 0
                  ? <p className="text-sm text-gray-400 py-4 text-center">No topics above 75% yet.</p>
                  : <ModalTopicTable topics={strongTopics} type="strong" />
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

function ModalTopicTable({ topics, type }) {
  const isStrong = type === 'strong'
  return (
    <div className="overflow-x-auto rounded-lg border" style={{ borderColor: isStrong ? '#bbf7d0' : '#fecaca' }}>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-gray-500 uppercase" style={{ background: isStrong ? '#f0fdf4' : '#fef2f2' }}>
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
            <tr key={t.topic} className={isStrong ? 'hover:bg-green-50' : 'hover:bg-red-50'}>
              <td className="px-4 py-2 font-medium text-gray-800 text-xs">{t.topic}</td>
              <td className="px-4 py-2">
                <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${t.subject === 'Science' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>{t.subject}</span>
              </td>
              <td className="px-4 py-2 text-center text-gray-600 text-xs">{t.count}</td>
              <td className="px-4 py-2 text-center">
                <span className={`font-bold text-sm ${isStrong ? 'text-green-700' : 'text-red-600'}`}>{t.avg}%</span>
              </td>
              <td className="px-4 py-2 text-center text-green-600 font-medium text-xs">{t.best}%</td>
              <td className="px-4 py-2 text-center text-red-500 font-medium text-xs">{t.worst}%</td>
              <td className="px-4 py-2 w-24">
                <div className="w-full bg-gray-100 rounded-full h-1.5">
                  <div className="h-1.5 rounded-full" style={{ width: `${t.avg}%`, background: isStrong ? '#16a34a' : '#ef4444' }} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function MiniStat({ label, value, highlight }) {
  return (
    <div className="rounded-lg p-3 text-center" style={highlight ? { background: DARK, border: `1px solid ${GOLD}` } : { background: '#fdf6ee' }}>
      <p className="text-xs mb-1" style={highlight ? { color: '#e0a030' } : { color: '#6b7280' }}>{label}</p>
      <p className="text-lg font-bold" style={highlight ? { color: GOLD } : { color: NAV }}>{value}</p>
    </div>
  )
}
