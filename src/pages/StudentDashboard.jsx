import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
  BarChart, Bar, ResponsiveContainer,
} from 'recharts'
import { supabase } from '../lib/supabase'

const GOLD  = '#c8860a'
const NAV   = '#2d1200'
const DARK  = '#1a0800'

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

  useEffect(() => {
    if (!session?.studentId) return
    supabase
      .from('student_scores')
      .select('*')
      .eq('student_id', session.studentId)
      .order('date', { ascending: true })
      .then(({ data }) => { setScores(data || []); setLoading(false) })
  }, [session?.studentId])

  useEffect(() => {
    if (!session?.studentId || !session?.class) return
    async function computeRank() {
      // Fetch classmates and all scores in parallel
      const [{ data: classmates }, { data: allScores }] = await Promise.all([
        supabase.from('student_emails').select('student_id').eq('class', session.class),
        supabase.from('student_scores').select('student_id, score_obtained, total_marks, is_absent'),
      ])

      if (!classmates?.length) return
      setClassSize(classmates.length)

      // Build avg map — default every classmate to 0
      const classmateIds = classmates.map((s) => String(s.student_id)).filter(Boolean)
      const avgMap = Object.fromEntries(classmateIds.map((id) => [id, { total: 0, count: 0 }]))

      ;(allScores || []).forEach((r) => {
        const key = String(r.student_id)
        if (!avgMap[key] || r.is_absent) return
        avgMap[key].total += (r.score_obtained / r.total_marks) * 100
        avgMap[key].count += 1
      })

      const ranked = Object.entries(avgMap)
        .map(([id, d]) => ({ id, avg: d.count > 0 ? d.total / d.count : 0 }))
        .sort((a, b) => b.avg - a.avg)

      const pos = ranked.findIndex((r) => r.id === String(session.studentId))
      setClassRank(pos >= 0 ? pos + 1 : null)
    }
    computeRank()
  }, [session?.studentId, session?.class])

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

  const strongTopics = useMemo(() => topicStats.filter((t) => t.avg >= 80).sort((a, b) => b.avg - a.avg), [topicStats])
  const weakTopics   = useMemo(() => topicStats.filter((t) => t.avg <  80).sort((a, b) => a.avg - b.avg), [topicStats])

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
    <div className="min-h-screen flex items-center justify-center" style={{ background: '#f8f3ed' }}>
      <div className="font-medium" style={{ color: GOLD }}>Loading your report…</div>
    </div>
  )

  return (
    <div className="min-h-screen" style={{ background: '#f8f3ed' }}>
      {/* Navbar */}
      <nav className="text-white px-4 py-3 flex items-center justify-between shadow-lg" style={{ background: NAV }}>
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-bold text-base flex-shrink-0">SVM</span>
          <span className="px-2 py-0.5 rounded-full text-xs font-medium truncate max-w-[140px] sm:max-w-none" style={{ background: GOLD }}>
            {session?.studentName}
          </span>
          <span className="px-2 py-0.5 rounded-full text-xs font-bold flex-shrink-0" style={{ background: DARK }}>
            Cl.{session?.class}
          </span>
        </div>
        <button
          onClick={logout}
          className="text-xs px-3 py-1.5 rounded-lg font-medium transition flex-shrink-0"
          style={{ background: DARK }}
          onMouseEnter={(e) => e.target.style.background = GOLD}
          onMouseLeave={(e) => e.target.style.background = DARK}
        >
          Logout
        </button>
      </nav>

      <div className="max-w-6xl mx-auto p-3 sm:p-6 space-y-4">

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
            <h2 className="text-sm font-semibold mb-2" style={{ color: NAV }}>Score Trend (%)</h2>
            {trendData.length === 0
              ? <p className="text-xs text-gray-400 py-8 text-center">No data yet.</p>
              : (
                <ResponsiveContainer width="100%" height={180}>
                  <LineChart data={trendData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0ebe4" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={48} interval="preserveStartEnd" />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} unit="%" />
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
              <h2 className="text-sm font-semibold mb-2" style={{ color: NAV }}>Subject Avg</h2>
              <ResponsiveContainer width="100%" height={100}>
                <BarChart data={subjectChartData} barSize={32}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0ebe4" />
                  <XAxis dataKey="subject" tick={{ fontSize: 11 }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} unit="%" />
                  <Tooltip formatter={(v) => `${v}%`} />
                  <Bar dataKey="avg" radius={[6, 6, 0, 0]} fill={GOLD} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="bg-white rounded-xl shadow p-3 sm:p-4 flex-1">
              <h2 className="text-sm font-semibold mb-2" style={{ color: NAV }}>Recent Tests</h2>
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
              { key: 'all',    label: '📋 All Tests',       count: scores.length },
              { key: 'strong', label: '🏆 Strong (≥80%)',   count: strongTopics.length },
              { key: 'weak',   label: '⚠️ Weak (<80%)',     count: weakTopics.length },
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
              <div className="px-3 sm:px-5 py-2.5 flex flex-wrap items-center gap-2 border-b border-gray-100" style={{ background: '#fdfaf6' }}>
                <div className="flex gap-1.5">
                  {['All', 'Science', 'Maths'].map((f) => (
                    <button key={f} onClick={() => setSubjectFilter(f)}
                      className="px-3 py-1 rounded-full text-xs font-medium transition"
                      style={subjectFilter === f ? { background: GOLD, color: 'white' } : { background: '#f5ede0', color: '#6b4c1e' }}
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
                        ? { background: NAV, color: GOLD }
                        : { background: '#f0ebe4', color: '#6b4c1e' }}
                    >{label}</button>
                  ))}
                </div>
                <span className="ml-auto text-xs text-gray-400">{displayedScores.length} tests</span>
              </div>

              {/* Scrollable table */}
              <div className="overflow-x-auto">
                <div className="overflow-y-auto" style={{ maxHeight: '420px' }}>
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 z-10">
                      <tr className="text-left text-xs text-gray-500 uppercase tracking-wide" style={{ background: '#fdf6ee' }}>
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
                            <td className="px-5 py-3 text-center font-medium">
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
              </div>
            </>
          )}

          {/* ── Strong Topics ── */}
          {tab === 'strong' && (
            <div className="p-5">
              <p className="text-xs text-gray-400 mb-3">Topics where your average is 80% or above — keep it up!</p>
              {strongTopics.length === 0
                ? <p className="text-gray-400 text-sm py-6 text-center">No topics above 75% yet. Keep practicing!</p>
                : <TopicTable topics={strongTopics} type="strong" />
              }
            </div>
          )}

          {tab === 'weak' && (
            <div className="p-5">
              <p className="text-xs text-gray-400 mb-3">Topics where your average is below 80% — focus here to improve your rank!</p>
              {weakTopics.length === 0
                ? <p className="text-gray-400 text-sm py-6 text-center">All topics above 75% — excellent!</p>
                : <TopicTable topics={weakTopics} type="weak" />
              }
            </div>
          )}
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

function TopicTable({ topics, type }) {
  const isStrong = type === 'strong'
  return (
    <div className="overflow-x-auto rounded-lg border" style={{ borderColor: isStrong ? '#bbf7d0' : '#fecaca' }}>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-gray-500 uppercase tracking-wide"
            style={{ background: isStrong ? '#f0fdf4' : '#fef2f2' }}>
            <th className="px-4 py-3">Chapter / Topic</th>
            <th className="px-4 py-3">Subject</th>
            <th className="px-4 py-3 text-center">Tests</th>
            <th className="px-4 py-3 text-center">Avg %</th>
            <th className="px-4 py-3 text-center">Best</th>
            <th className="px-4 py-3 text-center">Worst</th>
            <th className="px-4 py-3">Progress</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {topics.map((t) => (
            <tr key={t.topic} className={`transition ${isStrong ? 'hover:bg-green-50' : 'hover:bg-red-50'}`}>
              <td className="px-4 py-3 font-medium text-gray-800">{t.topic}</td>
              <td className="px-4 py-3">
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${t.subject === 'Science' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>
                  {t.subject}
                </span>
              </td>
              <td className="px-4 py-3 text-center text-gray-600">{t.count}</td>
              <td className="px-4 py-3 text-center">
                <span className={`font-bold ${isStrong ? 'text-green-700' : 'text-red-600'}`}>{t.avg}%</span>
              </td>
              <td className="px-4 py-3 text-center text-green-600 font-medium">{t.best}%</td>
              <td className="px-4 py-3 text-center text-red-500 font-medium">{t.worst}%</td>
              <td className="px-4 py-3 w-32">
                <div className="w-full bg-gray-100 rounded-full h-2">
                  <div className="h-2 rounded-full transition-all"
                    style={{ width: `${t.avg}%`, background: isStrong ? '#16a34a' : '#ef4444' }} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function StatCard({ label, value, sub, type }) {
  const styles = {
    gold:  { background: '#fef3d0', color: '#7a5100', border: '1px solid #f0d080', sub: '#a07030' },
    green: { background: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0', sub: '#16a34a' },
    red:   { background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca', sub: '#dc2626' },
    brown: { background: '#fdf6ee', color: '#6b4c1e', border: '1px solid #e8d5b0', sub: '#92623a' },
    rank:  { background: '#1a0800', color: '#c8860a', border: '1px solid #c8860a', sub: '#e0a030' },
  }
  const s = styles[type]
  return (
    <div className="rounded-xl p-5" style={{ background: s.background, border: s.border }}>
      <p className="text-xs font-medium mb-1" style={{ color: s.sub }}>{label}</p>
      <p className="text-2xl font-bold" style={{ color: s.color }}>{value}</p>
      {sub && <p className="text-xs mt-1" style={{ color: s.sub }}>{sub}</p>}
    </div>
  )
}
