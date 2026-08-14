import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { REPORT_TOPICS, MIN_PERCENTAGE_OPTIONS } from '../../constants/reportTopics'
import { parseScoreCsv, computeExamDate, parseCsvDateToInputValue, computeTotalMarksFromCsv, matchAndBuildRows } from '../../lib/updateReport'
import { downloadTextFile, checkDuplicateTest, buildAndDownloadReportCsvs, insertScoreRows, sendReportEmail } from '../../lib/reportSubmit'
import { GOLD, NAV, inputClass, focusGold, blurGold } from './formStyles'
import RecipientField from './RecipientField'

// Some students borrow a shared/temp device when they forget their own for
// a Learnyst test — the export then shows that device's own registered
// name/email, not whoever actually took it. This table is just a flat list
// of known shared-device emails (see scripts/create-report-shared-device-emails-table.sql);
// who really submitted under one varies every time, so it's never auto-matched.
const SHARED_DEVICE_EMAILS_TABLE = 'report_shared_device_emails'
// CSVs n8n pushes in via the report-csv-webhook edge function (see
// supabase/functions/report-csv-webhook/index.ts) land here for a teacher
// to review/edit/upload or reject, instead of downloading from email and
// browsing to the file by hand.
const CSV_QUEUE_TABLE = 'report_csv_queue'
const DEFAULT_RECIPIENT = 'svmambala@gmail.com'

export default function UpdateReport({ studentList, onInserted, teacherEmail }) {
  const [classNum, setClassNum] = useState('9')
  const [subject, setSubject] = useState('Science')
  const [topic, setTopic] = useState('')
  const [file, setFile] = useState(null)
  const [examDate, setExamDate] = useState('')
  const [totalMarks, setTotalMarks] = useState('')
  const [minPercentage, setMinPercentage] = useState('40')
  const [recipient, setRecipient] = useState(DEFAULT_RECIPIENT)
  const [stage, setStage] = useState('form') // 'form' | 'preview' | 'done'
  const [preview, setPreview] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [emailWarning, setEmailWarning] = useState('')

  // Shared-device handling: parsed as soon as a file is chosen (not gated
  // behind Preview), so the "who really took this?" popup can appear
  // immediately per the requested flow.
  const [sharedDeviceEmails, setSharedDeviceEmails] = useState([])
  const [csvRows, setCsvRows] = useState([])
  const [deviceRows, setDeviceRows] = useState([]) // flagged rows needing manual resolution
  const [deviceAssignments, setDeviceAssignments] = useState({}) // rowIndex -> student_id
  const [resolvingDevices, setResolvingDevices] = useState(false)

  // CSVs pushed in by n8n, waiting for a teacher to load/edit/upload or reject.
  const [queuedItems, setQueuedItems] = useState([])
  const [queuedItemId, setQueuedItemId] = useState(null) // which queue row (if any) the current form came from
  const [rejectingId, setRejectingId] = useState(null)

  useEffect(() => {
    supabase.from(SHARED_DEVICE_EMAILS_TABLE).select('*').then(({ data }) => setSharedDeviceEmails(data || []))
    fetchQueue()
  }, [])

  async function fetchQueue() {
    const { data } = await supabase.from(CSV_QUEUE_TABLE).select('*').order('received_at', { ascending: true })
    setQueuedItems(data || [])
  }

  const topics = REPORT_TOPICS[classNum]?.[subject] || []
  const classRoster = studentList.filter((s) => Number(s.class) === Number(classNum))

  function changeClass(c) { setClassNum(c); setTopic('') }
  function changeSubject(s) { setSubject(s); setTopic('') }

  // Shared by both the manual file picker and loading a queued CSV.
  function loadCsvRows(rows) {
    setCsvRows(rows)
    setDeviceRows([])
    setDeviceAssignments({})
    // Pre-fill from whatever Learnyst stamped on the submissions, same value
    // Preview would've computed anyway — the teacher can still edit it
    // before submitting if it's wrong or didn't parse.
    setExamDate(parseCsvDateToInputValue(computeExamDate(rows)))
    const knownEmails = new Set(sharedDeviceEmails.map((d) => d.email.toLowerCase()))
    const flagged = rows
      .map((r, rowIndex) => ({ ...r, rowIndex }))
      .filter((r) => r.learnerEmail && knownEmails.has(r.learnerEmail.toLowerCase()))
    if (flagged.length) {
      setDeviceRows(flagged)
      setResolvingDevices(true)
    }
  }

  async function pickFile(e) {
    const f = e.target.files?.[0] || null
    setError('')
    setFile(f)
    setQueuedItemId(null)
    setCsvRows([])
    setDeviceRows([])
    setDeviceAssignments({})
    setExamDate('')
    if (!f) return

    try {
      const text = await f.text()
      loadCsvRows(parseScoreCsv(text))
    } catch {
      // Preview will surface a proper "couldn't read that file" error.
    }
  }

  function loadQueuedItem(item) {
    setError('')
    setPreview(null)
    setStage('form')
    setFile({ name: item.filename })
    setQueuedItemId(item.id)
    loadCsvRows(parseScoreCsv(item.csv_content))
  }

  async function rejectQueuedItem(item) {
    setRejectingId(item.id)
    await supabase.from(CSV_QUEUE_TABLE).delete().eq('id', item.id)
    setQueuedItems((prev) => prev.filter((q) => q.id !== item.id))
    if (queuedItemId === item.id) resetForm()
    setRejectingId(null)
  }

  async function markAsSharedDevice(email) {
    if (!email) return
    const { data, error: insertErr } = await supabase
      .from(SHARED_DEVICE_EMAILS_TABLE)
      .upsert({ email: email.toLowerCase() }, { onConflict: 'email', ignoreDuplicates: true })
      .select()
    if (!insertErr && data) {
      setSharedDeviceEmails((prev) => [...prev.filter((d) => d.email !== email.toLowerCase()), ...data])
    }
  }

  async function handlePreview(e) {
    e.preventDefault()
    setError('')
    if (!file) { setError('Choose a CSV file to upload.'); return }
    if (!topic) { setError('Choose a topic.'); return }
    if (!examDate) { setError('Choose an exam date.'); return }
    if (!recipient.trim()) { setError('Enter a recipient email.'); return }
    if (!csvRows.length) { setError('That CSV has no usable rows.'); return }

    setBusy(true)
    try {
      // Unresolved shared-device rows must never be name-matched — a
      // device's own registered name could coincidentally match a real
      // roster student and silently mis-attribute their score.
      const excludeRowIndexes = new Set(
        deviceRows.filter((r) => !deviceAssignments[r.rowIndex]).map((r) => r.rowIndex)
      )
      // Resolved ones stand in for whichever real student the teacher picked.
      const resolvedCsvRows = csvRows.map((r, i) => {
        const assignedId = deviceAssignments[i]
        if (!assignedId) return r
        const assignedStudent = studentList.find((s) => s.student_id === assignedId)
        return assignedStudent ? { ...r, name: assignedStudent.student_name } : r
      })

      const effectiveTotalMarks = totalMarks && Number(totalMarks) > 0
        ? Number(totalMarks)
        : computeTotalMarksFromCsv(resolvedCsvRows)
      if (!effectiveTotalMarks) {
        throw new Error('Enter Total Marks — the CSV has no usable Total Score column to take it from.')
      }
      const totalMarksFromCsv = !totalMarks || Number(totalMarks) <= 0

      const { rows, unmatchedCsvNames } = matchAndBuildRows({
        roster: studentList, csvRows: resolvedCsvRows, classNum, subject, topicName: topic,
        totalMarks: effectiveTotalMarks, examDate, excludeRowIndexes,
      })
      if (!rows.length) throw new Error(`No Class ${classNum} students found in the roster.`)

      const duplicateCount = await checkDuplicateTest({ classNum, subject, topic, examDate })
      const { scoreCsv, attendanceCsv, fileTag } = buildAndDownloadReportCsvs({ rows, subject, studentList, topic, classNum })

      setPreview({
        rows, unmatchedCsvNames, examDate, totalMarks: effectiveTotalMarks, totalMarksFromCsv,
        duplicateCount, scoreCsv, attendanceCsv, fileTag,
      })
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
      // Reuse the exact CSVs already built (and downloaded) at Preview time,
      // so what the teacher inspected locally is byte-identical to what gets emailed.
      const { rows, examDate, totalMarks: effectiveTotalMarks, scoreCsv, attendanceCsv, fileTag } = preview
      const inserted = await insertScoreRows(rows)
      const emailOk = await sendReportEmail({
        recipient, topic, classNum, subject, examDate, minPercentage,
        totalMarks: effectiveTotalMarks, fileTag, scoreCsv, attendanceCsv,
      })

      onInserted?.(inserted || rows)

      if (queuedItemId) {
        await supabase.from(CSV_QUEUE_TABLE).delete().eq('id', queuedItemId)
        setQueuedItems((prev) => prev.filter((q) => q.id !== queuedItemId))
      }

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
    setExamDate('')
    setCsvRows([])
    setDeviceRows([])
    setDeviceAssignments({})
    setQueuedItemId(null)
    setTopic('')
    setTotalMarks('')
    setError('')
    setEmailWarning('')
  }

  return (
    <div className="space-y-4">
      {queuedItems.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-5 py-4 border-b flex items-center justify-between" style={{ background: NAV }}>
            <div>
              <p className="font-semibold text-gray-800">Pending CSV Uploads</p>
              <p className="text-xs text-gray-500 mt-0.5">Sent in automatically — load one to review/edit, or reject it.</p>
            </div>
            <button type="button" onClick={fetchQueue} className="text-xs font-semibold" style={{ color: GOLD }}>
              ↻ Refresh
            </button>
          </div>
          <div className="divide-y divide-gray-50">
            {queuedItems.map((item) => (
              <div key={item.id} className="px-5 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{item.filename}</p>
                  <p className="text-xs text-gray-400">{new Date(item.received_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button type="button" onClick={() => downloadTextFile(item.filename, item.csv_content)}
                    className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-gray-100 transition" style={{ color: 'var(--text)' }}
                  >
                    ⬇ Download
                  </button>
                  <button type="button" onClick={() => loadQueuedItem(item)}
                    className="text-xs font-semibold px-3 py-1.5 rounded-lg text-white transition"
                    style={{ background: queuedItemId === item.id ? '#16a34a' : GOLD }}
                  >
                    {queuedItemId === item.id ? '✓ Loaded' : 'Load'}
                  </button>
                  <button type="button" onClick={() => rejectQueuedItem(item)} disabled={rejectingId === item.id}
                    className="text-xs font-semibold px-3 py-1.5 rounded-lg text-red-500 hover:bg-red-50 transition disabled:opacity-50"
                  >
                    {rejectingId === item.id ? '…' : 'Reject'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-5 py-4 border-b" style={{ background: NAV }}>
          <p className="font-semibold text-gray-800">Upload CSV</p>
          <p className="text-xs text-gray-500 mt-0.5">
            {queuedItemId
              ? `Editing queued file: ${file?.name}`
              : 'Upload a Learnyst score export to record scores and email the report.'}
          </p>
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

            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1.5">Score file (Learnyst CSV export)</p>
              <label className="inline-block text-xs font-medium px-3 py-1.5 rounded-lg border cursor-pointer transition"
                style={{ borderColor: 'rgba(200,134,10,0.35)', color: GOLD, background: 'rgba(200,134,10,0.06)' }}
              >
                {file ? file.name : '📎 Choose CSV'}
                <input type="file" accept=".csv,text/csv" className="hidden" onChange={pickFile} />
              </label>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1.5">Exam Date</p>
                <input type="date" value={examDate} onChange={(e) => setExamDate(e.target.value)}
                  className={inputClass} onFocus={focusGold} onBlur={blurGold} />
                <p className="text-[11px] text-gray-400 mt-1">
                  {file ? 'Auto-filled from the CSV — change it if it looks wrong.' : 'Loads automatically once a CSV is chosen.'}
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1.5">Total Marks (optional)</p>
                <input type="number" min="1" placeholder="From CSV" value={totalMarks} onChange={(e) => setTotalMarks(e.target.value)}
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

            {error && <p className="text-sm text-red-500 font-medium">{error}</p>}

            <div>
              <button type="submit" disabled={busy}
                className="text-sm font-semibold px-5 py-2.5 rounded-lg text-white transition disabled:opacity-50"
                style={{ background: GOLD }}
              >
                {busy ? 'Reading file…' : 'Preview'}
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
                    <p className="text-2xl font-bold text-gray-800">{preview.examDate || '—'}</p>
                    <p className="text-[11px] text-gray-500 font-medium">Exam Date</p>
                  </div>
                  <div className="bg-gray-50 rounded-lg px-3 py-2.5 text-center">
                    <p className="text-2xl font-bold text-gray-800">{preview.totalMarks}</p>
                    <p className="text-[11px] text-gray-500 font-medium">
                      Total Marks{preview.totalMarksFromCsv ? ' (from CSV)' : ''}
                    </p>
                  </div>
                </div>
              )
            })()}

            {preview.unmatchedCsvNames.length > 0 && (
              <div className="rounded-lg px-3 py-2.5 text-sm space-y-2" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', color: '#b91c1c' }}>
                <p className="font-semibold">{preview.unmatchedCsvNames.length} row(s) in the CSV don't match any Class {classNum} student and will be skipped:</p>
                <div className="space-y-1">
                  {preview.unmatchedCsvNames.map((u) => {
                    const isKnownDevice = sharedDeviceEmails.some((d) => d.email === u.email?.toLowerCase())
                    return (
                      <div key={u.rowIndex} className="flex flex-wrap items-center gap-2 text-xs">
                        <span>{u.name}{u.email ? ` (${u.email})` : ''}</span>
                        {u.email && !isKnownDevice && (
                          <button type="button" onClick={() => markAsSharedDevice(u.email)}
                            className="font-semibold underline underline-offset-2"
                          >
                            + Mark as shared device
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {preview.duplicateCount > 0 && (
              <div className="rounded-lg px-3 py-2.5 text-sm" style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', color: '#92400e' }}>
                <p className="font-semibold">
                  {preview.duplicateCount} existing record(s) already match Class {classNum} · {subject} · {topic} · {preview.examDate}.
                </p>
                <p className="text-xs mt-0.5">Confirming will overwrite those existing records with these {preview.rows.length} rows' scores, not duplicate them.</p>
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

      {resolvingDevices && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center sm:p-4" onClick={() => setResolvingDevices(false)}>
          <div className="table-scroll bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-lg max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 bg-white border-b px-5 py-4 z-10">
              <p className="font-semibold text-gray-800">Shared device submissions found</p>
              <p className="text-xs text-gray-500 mt-1">
                {deviceRows.length} row{deviceRows.length !== 1 ? 's' : ''} used a known shared/temp device email — pick who actually took each one, since it varies by submission.
              </p>
            </div>
            <div className="p-5 space-y-4">
              {deviceRows.map((r) => (
                <div key={r.rowIndex} className="border border-gray-100 rounded-lg p-3">
                  <p className="text-xs text-gray-500 mb-2">
                    CSV says <span className="font-semibold text-gray-700">{r.name}</span> ({r.learnerEmail}) — score {r.score}/{r.totalScore}
                  </p>
                  <select
                    value={deviceAssignments[r.rowIndex] ?? ''}
                    onChange={(e) => setDeviceAssignments((prev) => ({
                      ...prev,
                      [r.rowIndex]: e.target.value ? Number(e.target.value) : undefined,
                    }))}
                    className={inputClass} onFocus={focusGold} onBlur={blurGold}
                  >
                    <option value="">Who actually took this? (leave blank to skip)</option>
                    {classRoster.map((s) => (
                      <option key={s.student_id} value={s.student_id}>
                        {s.student_name} — {s.emails?.[0]?.email || 'no email'}{s.phone ? ` — ${s.phone}` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            <div className="sticky bottom-0 bg-white border-t px-5 py-3 flex justify-end">
              <button type="button" onClick={() => setResolvingDevices(false)}
                className="text-sm font-semibold px-5 py-2.5 rounded-lg text-white transition" style={{ background: GOLD }}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
