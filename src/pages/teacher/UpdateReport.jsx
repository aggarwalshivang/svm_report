import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { REPORT_TOPICS, MIN_PERCENTAGE_OPTIONS } from '../../constants/reportTopics'
import { parseScoreCsv, computeExamDate, computeTotalMarksFromCsv, matchAndBuildRows, buildScoreCsv, buildAttendanceCsv } from '../../lib/updateReport'

// Some students borrow a shared/temp device when they forget their own for
// a Learnyst test — the export then shows that device's own registered
// name/email, not whoever actually took it. This table is just a flat list
// of known shared-device emails (see scripts/create-report-shared-device-emails-table.sql);
// who really submitted under one varies every time, so it's never auto-matched.
const SHARED_DEVICE_EMAILS_TABLE = 'report_shared_device_emails'

function downloadTextFile(filename, content) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

const GOLD = 'var(--gold)'
const NAV = 'var(--nav)'
const DEFAULT_RECIPIENT = 'svmambala@gmail.com'
// Same send-action-otp/verify-action-otp pair TeacherDashboard already uses
// to gate delete-student/delete-test/reopen-submissions — 'change-report-recipient'
// must be a known purpose in supabase/functions/send-action-otp/index.ts.
const CHANGE_RECIPIENT_OTP_PURPOSE = 'change-report-recipient'
const OTP_RESEND_COOLDOWN = 45 // seconds, must match send-action-otp's cooldown
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

export default function UpdateReport({ studentList, onInserted, teacherEmail }) {
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

  // Recipient is locked by default — changing it requires an OTP emailed to
  // the logged-in teacher's own account (send-action-otp/verify-action-otp),
  // same gate TeacherDashboard uses for delete-student/delete-test/etc.
  const [changingRecipient, setChangingRecipient] = useState(false)
  const [newRecipient, setNewRecipient] = useState('')
  const [otpStep, setOtpStep] = useState('idle') // 'idle' | 'sent'
  const [otpCode, setOtpCode] = useState('')
  const [otpSending, setOtpSending] = useState(false)
  const [otpVerifying, setOtpVerifying] = useState(false)
  const [otpError, setOtpError] = useState('')
  const [otpCooldown, setOtpCooldown] = useState(0)
  const cooldownRef = useRef(null)
  useEffect(() => () => clearInterval(cooldownRef.current), [])

  // Shared-device handling: parsed as soon as a file is chosen (not gated
  // behind Preview), so the "who really took this?" popup can appear
  // immediately per the requested flow.
  const [sharedDeviceEmails, setSharedDeviceEmails] = useState([])
  const [csvRows, setCsvRows] = useState([])
  const [deviceRows, setDeviceRows] = useState([]) // flagged rows needing manual resolution
  const [deviceAssignments, setDeviceAssignments] = useState({}) // rowIndex -> student_id
  const [resolvingDevices, setResolvingDevices] = useState(false)

  useEffect(() => {
    supabase.from(SHARED_DEVICE_EMAILS_TABLE).select('*').then(({ data }) => setSharedDeviceEmails(data || []))
  }, [])

  const topics = REPORT_TOPICS[classNum]?.[subject] || []
  const classRoster = studentList.filter((s) => Number(s.class) === Number(classNum))

  function changeClass(c) { setClassNum(c); setTopic('') }
  function changeSubject(s) { setSubject(s); setTopic('') }

  async function pickFile(e) {
    const f = e.target.files?.[0] || null
    setError('')
    setFile(f)
    setCsvRows([])
    setDeviceRows([])
    setDeviceAssignments({})
    if (!f) return

    try {
      const text = await f.text()
      const rows = parseScoreCsv(text)
      setCsvRows(rows)

      const knownEmails = new Set(sharedDeviceEmails.map((d) => d.email.toLowerCase()))
      const flagged = rows
        .map((r, rowIndex) => ({ ...r, rowIndex }))
        .filter((r) => r.learnerEmail && knownEmails.has(r.learnerEmail.toLowerCase()))
      if (flagged.length) {
        setDeviceRows(flagged)
        setResolvingDevices(true)
      }
    } catch {
      // Preview will surface a proper "couldn't read that file" error.
    }
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

  function startOtpCooldown() {
    setOtpCooldown(OTP_RESEND_COOLDOWN)
    clearInterval(cooldownRef.current)
    cooldownRef.current = setInterval(() => {
      setOtpCooldown((c) => {
        if (c <= 1) { clearInterval(cooldownRef.current); return 0 }
        return c - 1
      })
    }, 1000)
  }

  function openChangeRecipient() {
    setChangingRecipient(true)
    setNewRecipient('')
    setOtpStep('idle')
    setOtpCode('')
    setOtpError('')
  }

  function cancelChangeRecipient() {
    setChangingRecipient(false)
    setOtpStep('idle')
    setOtpCode('')
    setNewRecipient('')
    setOtpError('')
    clearInterval(cooldownRef.current)
    setOtpCooldown(0)
  }

  async function sendRecipientOtp() {
    setOtpError('')
    if (!/^\S+@\S+\.\S+$/.test(newRecipient.trim())) {
      setOtpError('Enter a valid email address.')
      return
    }
    setOtpSending(true)
    const { data, error: fnErr } = await supabase.functions.invoke('send-action-otp', {
      body: { purpose: CHANGE_RECIPIENT_OTP_PURPOSE },
    })
    setOtpSending(false)
    if (fnErr || data?.ok === false) {
      setOtpError(data?.error || fnErr?.message || 'Failed to send code.')
      return
    }
    startOtpCooldown()
    setOtpStep('sent')
  }

  async function verifyRecipientOtp() {
    setOtpError('')
    setOtpVerifying(true)
    const { data, error: fnErr } = await supabase.functions.invoke('verify-action-otp', {
      body: { code: otpCode.trim(), purpose: CHANGE_RECIPIENT_OTP_PURPOSE },
    })
    setOtpVerifying(false)
    if (fnErr || data?.ok === false) {
      setOtpError(data?.error || fnErr?.message || 'Invalid or expired code.')
      return
    }
    setRecipient(newRecipient.trim())
    cancelChangeRecipient()
  }

  async function handlePreview(e) {
    e.preventDefault()
    setError('')
    if (!file) { setError('Choose a CSV file to upload.'); return }
    if (!topic) { setError('Choose a topic.'); return }
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

      const examDate = computeExamDate(resolvedCsvRows)
      const { rows, unmatchedCsvNames } = matchAndBuildRows({
        roster: studentList, csvRows: resolvedCsvRows, classNum, subject, topicName: topic,
        totalMarks: effectiveTotalMarks, examDate, excludeRowIndexes,
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

      const sourceIdByStudentId = new Map(studentList.map((s) => [s.student_id, s.emails?.[0]?.source_id ?? '']))
      const scoreCsv = buildScoreCsv(rows, subject)
      const attendanceCsv = buildAttendanceCsv(rows, sourceIdByStudentId)
      const fileTag = `${topic} class ${classNum} subject ${subject}`
      downloadTextFile(`Score_classpro ${fileTag}.csv`, scoreCsv)
      downloadTextFile(`Attendance_classpro ${fileTag}.csv`, attendanceCsv)

      setPreview({
        rows, unmatchedCsvNames, examDate, totalMarks: effectiveTotalMarks, totalMarksFromCsv,
        duplicateCount: existing?.length || 0, scoreCsv, attendanceCsv, fileTag,
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
      const { data: inserted, error: insertErr } = await supabase.from('student_scores').insert(rows).select()
      if (insertErr) throw insertErr

      const message = `Classpro\n\nTopic:\n${topic}\n\nClass:\n${classNum}\n\nSubject:\n${subject}\n\nExam On:\n${examDate}\n\nMin Percentage:\n${minPercentage}\n\nTotal Marks:\n${effectiveTotalMarks}`

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
            totalMarks: effectiveTotalMarks,
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
    setCsvRows([])
    setDeviceRows([])
    setDeviceAssignments({})
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
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1.5">Total Marks (optional)</p>
                <input type="number" min="1" placeholder="From CSV" value={totalMarks} onChange={(e) => setTotalMarks(e.target.value)}
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
              {!changingRecipient ? (
                <div className="flex items-center gap-2">
                  <input type="email" value={recipient} disabled readOnly
                    className={`${inputClass} opacity-60 cursor-not-allowed`} />
                  <button type="button" onClick={openChangeRecipient}
                    className="text-xs font-semibold whitespace-nowrap flex-shrink-0" style={{ color: GOLD }}
                  >
                    🔒 Change
                  </button>
                </div>
              ) : (
                <div className="rounded-lg border p-3 space-y-2" style={{ borderColor: 'rgba(200,134,10,0.25)', background: 'rgba(200,134,10,0.06)' }}>
                  {otpStep === 'idle' ? (
                    <>
                      <input type="email" placeholder="New recipient email" value={newRecipient} autoFocus
                        onChange={(e) => setNewRecipient(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') sendRecipientOtp() }}
                        className={inputClass} onFocus={focusGold} onBlur={blurGold}
                      />
                      <p className="text-[11px] text-gray-500">
                        A confirmation code will be emailed to your account{teacherEmail ? ` (${teacherEmail})` : ''} to approve this change.
                      </p>
                      {otpError && <p className="text-xs text-red-500">{otpError}</p>}
                      <div className="flex gap-2">
                        <button type="button" onClick={sendRecipientOtp} disabled={otpSending}
                          className="text-xs font-semibold px-3 py-1.5 rounded-lg text-white transition disabled:opacity-50"
                          style={{ background: GOLD }}
                        >
                          {otpSending ? 'Sending…' : 'Send Code'}
                        </button>
                        <button type="button" onClick={cancelChangeRecipient}
                          className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-gray-100 transition" style={{ color: 'var(--text)' }}
                        >
                          Cancel
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <p className="text-xs text-gray-500">
                        Enter the 6-digit code sent to{teacherEmail ? ` ${teacherEmail}` : ' your account'} to confirm changing the recipient to <span className="font-medium">{newRecipient.trim()}</span>.
                      </p>
                      <input type="text" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoFocus
                        value={otpCode}
                        onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                        onKeyDown={(e) => { if (e.key === 'Enter' && otpCode.length === 6) verifyRecipientOtp() }}
                        placeholder="123456"
                        className={`${inputClass} tracking-[0.3em] text-center`} onFocus={focusGold} onBlur={blurGold}
                      />
                      {otpError && <p className="text-xs text-red-500">{otpError}</p>}
                      <div className="flex flex-wrap items-center gap-3">
                        <button type="button" onClick={verifyRecipientOtp} disabled={otpCode.length !== 6 || otpVerifying}
                          className="text-xs font-semibold px-3 py-1.5 rounded-lg text-white transition disabled:opacity-50"
                          style={{ background: GOLD }}
                        >
                          {otpVerifying ? 'Verifying…' : 'Verify & Update'}
                        </button>
                        <button type="button" onClick={sendRecipientOtp} disabled={otpCooldown > 0 || otpSending}
                          className="text-xs font-medium disabled:text-gray-400" style={{ color: otpCooldown > 0 ? undefined : GOLD }}
                        >
                          {otpCooldown > 0 ? `Resend code in ${otpCooldown}s` : 'Resend code'}
                        </button>
                        <button type="button" onClick={cancelChangeRecipient} className="text-xs font-semibold" style={{ color: 'var(--text)' }}>
                          Cancel
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>

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

      {resolvingDevices && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center sm:p-4" onClick={() => setResolvingDevices(false)}>
          <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-lg max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
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
