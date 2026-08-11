import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { REPORT_TOPICS, MIN_PERCENTAGE_OPTIONS } from '../../constants/reportTopics'
import { parseScoreCsv, computeExamDate, matchAndBuildRows, buildScoreCsv, buildAttendanceCsv } from '../../lib/updateReport'

const GOLD = 'var(--gold)'
const NAV = 'var(--nav)'
const DEFAULT_RECIPIENT = 'svmambala@gmail.com'
// A trimmed n8n workflow (see n8n/update-report-mail-webhook.json) must be
// imported and activated at this path — it only attaches the two CSVs
// below to a Gmail message, all the parsing/matching/DB-write already
// happened here.
const N8N_UPDATE_REPORT_WEBHOOK = 'https://n8n.saraswatividyamandir.com/webhook/svm-update-report-mail'

function toBase64(str) {
  return btoa(unescape(encodeURIComponent(str)))
}

const inputClass = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none bg-white'
function focusGold(e) { e.target.style.boxShadow = `0 0 0 2px ${GOLD}40` }
function blurGold(e) { e.target.style.boxShadow = '' }

export default function UpdateReport({ studentList, onInserted }) {
  const [classNum, setClassNum] = useState('9')
  const [subject, setSubject] = useState('Science')
  const [topic, setTopic] = useState('')
  const [file, setFile] = useState(null)
  const [totalMarks, setTotalMarks] = useState('')
  const [minPercentage, setMinPercentage] = useState('40')
  const [recipient, setRecipient] = useState(DEFAULT_RECIPIENT)
  const [stage, setStage] = useState('form') // 'form' | 'preview' | 'done'
  const [preview, setPreview] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [emailWarning, setEmailWarning] = useState('')

  const topics = REPORT_TOPICS[classNum]?.[subject] || []

  function changeClass(c) { setClassNum(c); setTopic('') }
  function changeSubject(s) { setSubject(s); setTopic('') }

  async function handlePreview(e) {
    e.preventDefault()
    setError('')
    if (!file) { setError('Choose a CSV file to upload.'); return }
    if (!topic) { setError('Choose a topic.'); return }
    if (!totalMarks || Number(totalMarks) <= 0) { setError('Enter Total Marks.'); return }
    if (!recipient.trim()) { setError('Enter a recipient email.'); return }

    setBusy(true)
    try {
      const text = await file.text()
      const csvRows = parseScoreCsv(text)
      if (!csvRows.length) throw new Error('No rows found in that CSV.')

      const examDate = computeExamDate(csvRows)
      const { rows, unmatchedCsvNames } = matchAndBuildRows({
        roster: studentList, csvRows, classNum, subject, topicName: topic, totalMarks, examDate,
      })
      if (!rows.length) throw new Error(`No Class ${classNum} students found in the roster.`)

      const { data: existing, error: dupErr } = await supabase
        .from('student_scores')
        .select('id')
        .eq('class', Number(classNum))
        .eq('subject', subject)
        .eq('topic_name', topic)
        .eq('date', examDate)
      if (dupErr) throw dupErr

      setPreview({ rows, unmatchedCsvNames, examDate, duplicateCount: existing?.length || 0 })
      setStage('preview')
    } catch (err) {
      setError(err.message || 'Failed to read that file.')
    }
    setBusy(false)
  }

  async function handleConfirm() {
    setBusy(true)
    setError('')
    try {
      const { rows, examDate } = preview
      const { data: inserted, error: insertErr } = await supabase.from('student_scores').insert(rows).select()
      if (insertErr) throw insertErr

      const sourceIdByStudentId = new Map(studentList.map((s) => [s.student_id, s.emails?.[0]?.source_id ?? '']))
      const scoreCsv = buildScoreCsv(rows, subject)
      const attendanceCsv = buildAttendanceCsv(rows, sourceIdByStudentId)
      const fileTag = `${topic} class ${classNum} subject ${subject}`
      const message = `Classpro\n\nTopic:\n${topic}\n\nClass:\n${classNum}\n\nSubject:\n${subject}\n\nExam On:\n${examDate}\n\nMin Percentage:\n${minPercentage}\n\nTotal Marks:\n${totalMarks}`

      let emailOk = true
      try {
        const res = await fetch(N8N_UPDATE_REPORT_WEBHOOK, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to: recipient.trim(),
            subject: `classpro ${fileTag}`,
            message,
            examDate,
            minPercentage,
            totalMarks,
            scoreCsv: { filename: `Score_classpro ${fileTag}.csv`, content: toBase64(scoreCsv) },
            attendanceCsv: { filename: `Attendance_classpro ${fileTag}.csv`, content: toBase64(attendanceCsv) },
          }),
        })
        emailOk = res.ok
      } catch {
        emailOk = false
      }

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
    setFile(null)
    setTopic('')
    setTotalMarks('')
    setError('')
    setEmailWarning('')
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-5 py-4 border-b" style={{ background: NAV }}>
          <p className="font-semibold text-gray-800">Update Report</p>
          <p className="text-xs text-gray-500 mt-0.5">Upload a Learnyst score export to record scores and email the report.</p>
        </div>

        {stage === 'form' && (
          <form onSubmit={handlePreview} className="p-5 space-y-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1.5">Class</p>
              <div className="flex gap-2">
                {['9', '10'].map((c) => (
                  <button key={c} type="button" onClick={() => changeClass(c)}
                    className="px-4 py-1.5 rounded-lg text-sm font-medium transition"
                    style={classNum === c ? { background: GOLD, color: 'white' } : { background: '#f9fafb', color: 'var(--text)', border: '1px solid #e5e7eb' }}
                  >
                    Class {c}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1.5">Subject</p>
              <div className="flex gap-2">
                {['Science', 'Maths'].map((s) => (
                  <button key={s} type="button" onClick={() => changeSubject(s)}
                    className="px-4 py-1.5 rounded-lg text-sm font-medium transition"
                    style={subject === s ? { background: GOLD, color: 'white' } : { background: '#f9fafb', color: 'var(--text)', border: '1px solid #e5e7eb' }}
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

            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1.5">Score file (Learnyst CSV export)</p>
              <input type="file" accept=".csv,text/csv" onChange={(e) => setFile(e.target.files?.[0] || null)} className="text-sm" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1.5">Total Marks</p>
                <input type="number" min="1" value={totalMarks} onChange={(e) => setTotalMarks(e.target.value)}
                  className={inputClass} onFocus={focusGold} onBlur={blurGold} />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1.5">Min Percentage</p>
                <select value={minPercentage} onChange={(e) => setMinPercentage(e.target.value)} className={inputClass} onFocus={focusGold} onBlur={blurGold}>
                  {MIN_PERCENTAGE_OPTIONS.map((p) => <option key={p} value={p}>{p}%</option>)}
                </select>
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1.5">Send report to</p>
              <input type="email" value={recipient} onChange={(e) => setRecipient(e.target.value)}
                className={inputClass} onFocus={focusGold} onBlur={blurGold} />
            </div>

            {error && <p className="text-sm text-red-500 font-medium">{error}</p>}

            <button type="submit" disabled={busy}
              className="text-sm font-semibold px-5 py-2.5 rounded-lg text-white transition disabled:opacity-50"
              style={{ background: GOLD }}
            >
              {busy ? 'Reading file…' : 'Preview'}
            </button>
          </form>
        )}

        {stage === 'preview' && preview && (
          <div className="p-5 space-y-4">
            {(() => {
              const matched = preview.rows.filter((r) => !r.is_absent)
              const absent = preview.rows.filter((r) => r.is_absent)
              return (
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-gray-50 rounded-lg px-3 py-2.5 text-center">
                    <p className="text-2xl font-bold text-gray-800">{matched.length}</p>
                    <p className="text-[11px] text-gray-500 font-medium">Scored</p>
                  </div>
                  <div className="bg-gray-50 rounded-lg px-3 py-2.5 text-center">
                    <p className="text-2xl font-bold text-gray-800">{absent.length}</p>
                    <p className="text-[11px] text-gray-500 font-medium">Absent</p>
                  </div>
                  <div className="bg-gray-50 rounded-lg px-3 py-2.5 text-center">
                    <p className="text-2xl font-bold text-gray-800">{preview.examDate || '—'}</p>
                    <p className="text-[11px] text-gray-500 font-medium">Exam Date</p>
                  </div>
                </div>
              )
            })()}

            {preview.unmatchedCsvNames.length > 0 && (
              <div className="rounded-lg px-3 py-2.5 text-sm" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', color: '#b91c1c' }}>
                <p className="font-semibold mb-1">{preview.unmatchedCsvNames.length} name(s) in the CSV don't match any Class {classNum} student and will be skipped:</p>
                <p className="text-xs">{preview.unmatchedCsvNames.join(', ')}</p>
              </div>
            )}

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
                className="text-sm font-semibold px-5 py-2.5 rounded-lg transition disabled:opacity-50"
                style={{ background: '#f3f4f6', color: 'var(--text)' }}
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
    </div>
  )
}
