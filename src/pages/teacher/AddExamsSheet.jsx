import { useState } from 'react'
import { REPORT_TOPICS, MIN_PERCENTAGE_OPTIONS } from '../../constants/reportTopics'
import { checkDuplicateTest, buildAndDownloadReportCsvs, insertScoreRows, sendReportEmail } from '../../lib/reportSubmit'
import { applyMarksRules } from '../../lib/updateReport'
import { GOLD, NAV, inputClass, focusGold, blurGold } from './formStyles'
import RecipientField from './RecipientField'

const DEFAULT_RECIPIENT = 'svmambala@gmail.com'
const todayISO = () => new Date().toISOString().slice(0, 10)

// Manual entry, no CSV: the teacher directly marks each roster student
// present/absent and types their score. Every row is already tied to a
// real student_id, so there's no name-matching or shared-device handling
// to do here — that's specific to the "App" (CSV upload) tab.
export default function AddExamsSheet({ studentList, onInserted, teacherEmail }) {
  const [classNum, setClassNum] = useState('9')
  const [subject, setSubject] = useState('Science')
  const [topic, setTopic] = useState('')
  const [examDate, setExamDate] = useState(todayISO)
  const [totalMarks, setTotalMarks] = useState('')
  const [minPercentage, setMinPercentage] = useState('40')
  const [recipient, setRecipient] = useState(DEFAULT_RECIPIENT)
  const [search, setSearch] = useState('')
  const [entries, setEntries] = useState({}) // student_id -> { present, score }
  const [stage, setStage] = useState('form') // 'form' | 'preview' | 'done'
  const [preview, setPreview] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [emailWarning, setEmailWarning] = useState('')

  const topics = REPORT_TOPICS[classNum]?.[subject] || []
  const classRoster = studentList.filter((s) => Number(s.class) === Number(classNum))
  const filteredRoster = classRoster.filter((s) => !search || s.student_name.toLowerCase().includes(search.toLowerCase()))

  function entryFor(studentId) {
    return entries[studentId] ?? { present: true, score: '' }
  }

  function changeClass(c) { setClassNum(c); setTopic(''); setEntries({}) }
  function changeSubject(s) { setSubject(s); setTopic('') }

  function togglePresent(studentId) {
    setEntries((prev) => ({ ...prev, [studentId]: { ...entryFor(studentId), present: !entryFor(studentId).present } }))
  }
  function setScore(studentId, value) {
    setEntries((prev) => ({ ...prev, [studentId]: { ...entryFor(studentId), score: value } }))
  }

  async function handlePreview(e) {
    e.preventDefault()
    setError('')
    if (!topic) { setError('Choose a topic.'); return }
    if (!totalMarks || Number(totalMarks) <= 0) { setError('Enter Total Marks.'); return }
    if (!examDate) { setError('Choose an exam date.'); return }
    if (!recipient.trim()) { setError('Enter a recipient email.'); return }
    if (!classRoster.length) { setError(`No Class ${classNum} students found in the roster.`); return }

    const missingScores = classRoster.filter((s) => {
      const entry = entryFor(s.student_id)
      return entry.present && !String(entry.score).trim()
    })
    if (missingScores.length) {
      setError(`Enter a score for: ${missingScores.map((s) => s.student_name).join(', ')}`)
      return
    }

    setBusy(true)
    try {
      const rows = classRoster.map((s) => {
        const entry = entryFor(s.student_id)
        const isAbsent = !entry.present
        return {
          student_id: s.student_id,
          student_name: s.student_name,
          class: Number(classNum),
          subject,
          topic_name: topic,
          total_marks: Number(totalMarks),
          date: examDate,
          score_obtained: isAbsent ? 0 : applyMarksRules(Number(entry.score), totalMarks, minPercentage),
          is_absent: isAbsent,
        }
      })

      const duplicateCount = await checkDuplicateTest({ classNum, subject, topic, examDate })
      const { scoreCsv, attendanceCsv, fileTag } = buildAndDownloadReportCsvs({ rows, subject, studentList, topic, classNum })

      setPreview({ rows, examDate, totalMarks: Number(totalMarks), duplicateCount, scoreCsv, attendanceCsv, fileTag })
      setStage('preview')
    } catch (err) {
      setError(err.message || 'Failed to build the preview.')
    }
    setBusy(false)
  }

  async function handleConfirm() {
    setBusy(true)
    setError('')
    try {
      const { rows, examDate: date, totalMarks: effectiveTotalMarks, scoreCsv, attendanceCsv, fileTag } = preview
      const inserted = await insertScoreRows(rows)
      const emailOk = await sendReportEmail({
        recipient, topic, classNum, subject, examDate: date, minPercentage,
        totalMarks: effectiveTotalMarks, fileTag, scoreCsv, attendanceCsv,
      })
      onInserted?.(inserted || rows)
      setEmailWarning(emailOk ? '' : 'Scores were saved, but the report email failed to send.')
      setStage('done')
    } catch (err) {
      setError(err.message || 'Failed to save scores.')
    }
    setBusy(false)
  }

  function resetForm() {
    setStage('form')
    setPreview(null)
    setEntries({})
    setTopic('')
    setTotalMarks('')
    setSearch('')
    setError('')
    setEmailWarning('')
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="px-5 py-4 border-b" style={{ background: NAV }}>
        <p className="font-semibold text-gray-800">Manual Sheet</p>
        <p className="text-xs text-gray-500 mt-0.5">No CSV — mark attendance and enter scores directly for the class roster.</p>
      </div>

      {stage === 'form' && (
        <form onSubmit={handlePreview} className="p-5 space-y-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1.5">Class</p>
            <div className="flex bg-gray-50 rounded-lg border border-gray-200 p-1 gap-1 w-fit">
              {['9', '10'].map((c) => (
                <button key={c} type="button" onClick={() => changeClass(c)}
                  className="px-4 py-1.5 rounded-md text-sm font-medium transition"
                  style={classNum === c ? { background: GOLD, color: 'white' } : { color: 'var(--text)' }}
                >
                  Class {c}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1.5">Subject</p>
            <div className="flex bg-gray-50 rounded-lg border border-gray-200 p-1 gap-1 w-fit">
              {['Science', 'Maths'].map((s) => (
                <button key={s} type="button" onClick={() => changeSubject(s)}
                  className="px-4 py-1.5 rounded-md text-sm font-medium transition"
                  style={subject === s ? { background: GOLD, color: 'white' } : { color: 'var(--text)' }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1.5">Topic</p>
            <select value={topic} onChange={(e) => setTopic(e.target.value)} className={inputClass} onFocus={focusGold} onBlur={blurGold}>
              <option value="">Select a topic…</option>
              {topics.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1.5">Exam Date</p>
              <input type="date" value={examDate} onChange={(e) => setExamDate(e.target.value)}
                className={inputClass} onFocus={focusGold} onBlur={blurGold} />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1.5">Total Marks</p>
              <input type="number" min="1" value={totalMarks} onChange={(e) => setTotalMarks(e.target.value)}
                className={inputClass} onFocus={focusGold} onBlur={blurGold} />
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1.5">Min Percentage</p>
            <select value={minPercentage} onChange={(e) => setMinPercentage(e.target.value)} className={inputClass} onFocus={focusGold} onBlur={blurGold}>
              {MIN_PERCENTAGE_OPTIONS.map((p) => <option key={p} value={p}>{p}%</option>)}
            </select>
          </div>

          <RecipientField recipient={recipient} onChange={setRecipient} teacherEmail={teacherEmail} />

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                Attendance & Scores ({classRoster.length} students)
              </p>
            </div>
            <input type="text" placeholder="Search student…" value={search} onChange={(e) => setSearch(e.target.value)}
              className={`${inputClass} mb-2`} onFocus={focusGold} onBlur={blurGold} />
            <div className="table-scroll border border-gray-100 rounded-lg divide-y divide-gray-50 max-h-96 overflow-y-auto">
              {filteredRoster.map((s) => {
                const entry = entryFor(s.student_id)
                return (
                  <div key={s.student_id} className="px-3 py-2 flex items-center gap-3">
                    <label className="flex items-center gap-1.5 flex-shrink-0 cursor-pointer w-20">
                      <input type="checkbox" checked={entry.present} onChange={() => togglePresent(s.student_id)} />
                      <span className="text-xs" style={{ color: entry.present ? '#16a34a' : '#ef4444' }}>
                        {entry.present ? 'Present' : 'Absent'}
                      </span>
                    </label>
                    <span className="flex-1 text-sm text-gray-800 truncate">{s.student_name}</span>
                    <input type="number" min="0" placeholder="Score" value={entry.score}
                      disabled={!entry.present}
                      onChange={(e) => setScore(s.student_id, e.target.value)}
                      className="w-20 border border-gray-200 rounded-lg px-2 py-1 text-sm text-center disabled:opacity-40 disabled:bg-gray-50 focus:outline-none"
                      onFocus={focusGold} onBlur={blurGold}
                    />
                  </div>
                )
              })}
              {filteredRoster.length === 0 && (
                <p className="text-center text-gray-400 text-sm py-6">No students match.</p>
              )}
            </div>
          </div>

          {error && <p className="text-sm text-red-500 font-medium">{error}</p>}

          <div>
            <button type="submit" disabled={busy}
              className="text-sm font-semibold px-5 py-2.5 rounded-lg text-white transition disabled:opacity-50"
              style={{ background: GOLD }}
            >
              {busy ? 'Building…' : 'Preview'}
            </button>
            <p className="text-[11px] text-gray-400 mt-1.5">Downloads the two report CSVs to check — nothing is saved or emailed yet.</p>
          </div>
        </form>
      )}

      {stage === 'preview' && preview && (
        <div className="p-5 space-y-4">
          {(() => {
            const matched = preview.rows.filter((r) => !r.is_absent)
            const absent = preview.rows.filter((r) => r.is_absent)
            return (
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-gray-50 rounded-lg px-3 py-2.5 text-center">
                  <p className="text-2xl font-bold text-gray-800">{matched.length}</p>
                  <p className="text-[11px] text-gray-500 font-medium">Scored</p>
                </div>
                <div className="bg-gray-50 rounded-lg px-3 py-2.5 text-center">
                  <p className="text-2xl font-bold text-gray-800">{absent.length}</p>
                  <p className="text-[11px] text-gray-500 font-medium">Absent</p>
                </div>
                <div className="bg-gray-50 rounded-lg px-3 py-2.5 text-center">
                  <p className="text-2xl font-bold text-gray-800">{preview.examDate}</p>
                  <p className="text-[11px] text-gray-500 font-medium">Exam Date</p>
                </div>
                <div className="bg-gray-50 rounded-lg px-3 py-2.5 text-center">
                  <p className="text-2xl font-bold text-gray-800">{preview.totalMarks}</p>
                  <p className="text-[11px] text-gray-500 font-medium">Total Marks</p>
                </div>
              </div>
            )
          })()}

          {preview.duplicateCount > 0 && (
            <div className="rounded-lg px-3 py-2.5 text-sm" style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', color: '#92400e' }}>
              <p className="font-semibold">
                {preview.duplicateCount} existing record(s) already match Class {classNum} · {subject} · {topic} · {preview.examDate}.
              </p>
              <p className="text-xs mt-0.5">Confirming will add these {preview.rows.length} rows on top of the existing ones — it will not replace them.</p>
            </div>
          )}

          {error && <p className="text-sm text-red-500 font-medium">{error}</p>}

          <div className="flex gap-2">
            <button type="button" onClick={handleConfirm} disabled={busy}
              className="text-sm font-semibold px-5 py-2.5 rounded-lg text-white transition disabled:opacity-50"
              style={{ background: GOLD }}
            >
              {busy ? 'Saving…' : preview.duplicateCount > 0 ? 'Confirm Anyway & Send' : 'Confirm & Send'}
            </button>
            <button type="button" onClick={() => setStage('form')} disabled={busy}
              className="text-sm font-semibold px-5 py-2.5 rounded-lg bg-gray-100 transition disabled:opacity-50"
              style={{ color: 'var(--text)' }}
            >
              Back
            </button>
          </div>
        </div>
      )}

      {stage === 'done' && (
        <div className="p-5 space-y-3">
          <p className="text-sm font-semibold" style={{ color: emailWarning ? '#b45309' : '#16a34a' }}>
            {emailWarning ? `✓ Scores saved. ${emailWarning}` : '✓ Scores saved and report email sent.'}
          </p>
          <button type="button" onClick={resetForm}
            className="text-sm font-semibold px-5 py-2.5 rounded-lg text-white transition"
            style={{ background: GOLD }}
          >
            Add Another
          </button>
        </div>
      )}
    </div>
  )
}
