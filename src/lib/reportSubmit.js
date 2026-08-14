// Shared submit-side logic for the Add Exams tabs (App = CSV upload,
// Sheet = manual entry) — both end up with the same `rows` shape
// (student_id, student_name, class, subject, topic_name, total_marks,
// score_obtained, is_absent, date) and go through the same
// duplicate-check -> build+download CSVs -> insert -> email pipeline.
import { supabase } from './supabase'
import { buildScoreCsv, buildAttendanceCsv } from './updateReport'

// A trimmed n8n workflow (see n8n/update-report-mail-webhook.json) must be
// imported and activated at this path — it only attaches the two CSVs
// below to a Gmail message, all the parsing/matching/DB-write already
// happened here.
export const N8N_UPDATE_REPORT_WEBHOOK = 'https://n8n.saraswatividyamandir.com/webhook/classpro-mail-send'

export function toBase64(str) {
  return btoa(unescape(encodeURIComponent(str)))
}

export function downloadTextFile(filename, content) {
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

export async function checkDuplicateTest({ classNum, subject, topic, examDate }) {
  const { data, error } = await supabase
    .from('student_scores')
    .select('id')
    .eq('class', Number(classNum))
    .eq('subject', subject)
    .eq('topic_name', topic)
    .eq('date', examDate)
  if (error) throw error
  return data?.length || 0
}

// Builds the two report CSVs from already-computed rows and downloads both
// locally, so the teacher can inspect exactly what will be emailed.
export function buildAndDownloadReportCsvs({ rows, subject, studentList, topic, classNum }) {
  const sourceIdByStudentId = new Map(studentList.map((s) => [s.student_id, s.emails?.[0]?.source_id ?? '']))
  const scoreCsv = buildScoreCsv(rows, subject)
  const attendanceCsv = buildAttendanceCsv(rows, sourceIdByStudentId)
  const fileTag = `${topic} class ${classNum} subject ${subject}`
  downloadTextFile(`Score_classpro ${fileTag}.csv`, scoreCsv)
  downloadTextFile(`Attendance_classpro ${fileTag}.csv`, attendanceCsv)
  return { scoreCsv, attendanceCsv, fileTag }
}

// Upserts on (student_id, class, subject, topic_name, date) — see
// scripts/add-unique-key-to-student-scores.sql — so re-confirming the same
// test (a retry, or pushing through the duplicate-test warning) updates the
// existing row instead of piling on another copy.
export async function insertScoreRows(rows) {
  const { data, error } = await supabase
    .from('student_scores')
    .upsert(rows, { onConflict: 'student_id,class,subject,topic_name,date' })
    .select()
  if (error) throw error
  return data
}

// Best-effort — a failed email shouldn't undo the already-saved scores, so
// this never throws; callers surface `false` as a warning instead.
export async function sendReportEmail({ recipient, topic, classNum, subject, examDate, minPercentage, totalMarks, fileTag, scoreCsv, attendanceCsv }) {
  const message = `Classpro\n\nTopic:\n${topic}\n\nClass:\n${classNum}\n\nSubject:\n${subject}\n\nExam On:\n${examDate}\n\nMin Percentage:\n${minPercentage}\n\nTotal Marks:\n${totalMarks}`
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
    return res.ok
  } catch {
    return false
  }
}
