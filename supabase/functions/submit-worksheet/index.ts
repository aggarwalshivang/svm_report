// Forwards a student's worksheet PDF to the n8n "student-form-worksheet"
// webhook (same field names/query params its hosted form uses) and records
// the submission in Supabase so the student dashboard can show a
// Submitted/Missing status without needing n8n to call back.
//
// The upload goes browser -> this function -> n8n, not browser -> n8n
// directly, so we never have to deal with CORS on the n8n side.
//
// n8n's grading step responds synchronously (confirmed against real
// submissions — not the ~5min async callback originally assumed), with a
// body shaped like:
//   [{ "portion": "Algebraic-Identities-|-Class-9",
//      "student_matched": "Ridhi Goyal | Class 9",
//      "feedback": "\"Hi ,\n\n...\n\n*Handwriting:* ...\n\n...\"" }]
// — an array, and `feedback` is sometimes double-JSON-encoded (literal
// quote chars at each end). When the AI couldn't read the scan it returns
// the exact string "no feedback" instead of real commentary; that's treated
// as a rejected submission (nothing is recorded, student is told to
// resubmit) rather than being saved as empty feedback, since any
// worksheet_feedback/assignment_submissions row at all would mark the
// assignment Completed on the student dashboard.
//
// If n8n's response doesn't parse into this shape (e.g. it just says
// "Workflow was started"), the submission is still recorded — grading
// presumably happens later — it just doesn't have feedback yet.
//
// FAST_PATH_MS / background grading: n8n is usually done in a few seconds,
// but its tail (busy AI queue, a big scan) can run well past a minute.
// Holding the student's connection open that whole time is exactly what was
// producing frequent "Failed to send a request" errors on real phones —
// mobile networks kill long-idle connections independently of any timeout
// we set, so the request can succeed server-side and still look failed to
// the student. So: race the n8n call against a short window. If it settles
// within that window (the common case), respond inline exactly as before.
// If not, stop waiting on it — the connection closes now — and let grading
// keep running in the background via EdgeRuntime.waitUntil, writing the
// same rows once it finishes. The one behavior change: if a *slow* grading
// call also comes back "no feedback" (unreadable scan), the student won't
// see that rejection message live — the assignment just silently stays
// un-submitted rather than flipping to Completed — since by then the
// response has already gone out. That combination (slow AND unreadable) is
// rare; a stuck-forever "connection issue" on every slow-but-fine scan,
// which is what was actually happening "quite often", is not.
//
// Deploy:
//   npx supabase functions deploy submit-worksheet --no-verify-jwt

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const N8N_WEBHOOK_URL = 'https://n8n.saraswatividyamandir.com/webhook/student-form-worksheet'
const MAX_FILE_BYTES = 20 * 1024 * 1024

// How long we hold the student's connection open waiting for n8n before
// switching to the background path.
const FAST_PATH_MS = 15_000
// Hard backstop for the n8n call itself, fast path or background.
const N8N_TIMEOUT_MS = 170_000

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Pulls the "*Handwriting:* ..." line out of the combined feedback blob;
// whatever's left (greeting + answer-correctness commentary) becomes the
// assignment feedback.
function splitFeedback(feedback: string): { handwriting: string | null; rest: string } {
  const m = feedback.match(/^([^\n]*Handwriting:?\*?\s*)([^\n]*)$/im)
  if (!m) return { handwriting: null, rest: feedback.trim() }
  const handwriting = m[2].trim()
  const rest = feedback.replace(m[0], '').replace(/\n{3,}/g, '\n\n').trim()
  return { handwriting, rest: rest || feedback.trim() }
}

// Extracts+normalizes the `feedback` string out of n8n's response body,
// which may be a bare object or (per real observed responses) a
// single-element array, and may have its `feedback` field double-encoded.
function extractFeedbackText(n8nBody: unknown): string | null {
  const item = Array.isArray(n8nBody) ? n8nBody[0] : n8nBody
  if (!item || typeof item !== 'object' || !('feedback' in item)) return null
  let text = String((item as { feedback: unknown }).feedback ?? '').trim()
  if (text.startsWith('"') && text.endsWith('"')) {
    try {
      text = JSON.parse(text)
    } catch {
      text = text.slice(1, -1)
    }
  }
  return text || null
}

type GradeResult =
  | { status: 'ok' }
  | { status: 'rejected'; message: string }
  | { status: 'error'; message: string }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
  const fail = (error: string, status = 400) =>
    new Response(JSON.stringify({ ok: false, error }), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  try {
    // Only a logged-in (student or teacher) session may submit.
    const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '')
    if (!token) throw new Error('Your session has expired. Please log out and log in again, then submit your worksheet.')
    const { data: caller, error: callerErr } = await admin.auth.getUser(token)
    if (callerErr || !caller?.user) throw new Error('Your session has expired. Please log out and log in again, then submit your worksheet.')

    const form = await req.formData()
    const file = form.get('file')
    if (!(file instanceof File)) throw new Error('Please choose a PDF file before submitting.')
    if (file.type !== 'application/pdf') throw new Error('Only PDF files are accepted. Please convert your file to PDF and try again.')
    if (file.size > MAX_FILE_BYTES) throw new Error('This file is too large. Please upload a file smaller than 20 MB.')

    const assignmentId = String(form.get('assignment_id') ?? '')
    const studentId = Number(form.get('student_id'))
    const studentName = String(form.get('student_name') ?? '').trim()
    const className = String(form.get('class') ?? '').trim()
    const portion = String(form.get('portion') ?? '')
    const folder = String(form.get('folder') ?? '')
    const worksheet = String(form.get('worksheet') ?? '')
    const assignmentName = String(form.get('assignment_name') ?? '').trim() || portion
    const subject = String(form.get('subject') ?? '').trim() || 'General'
    if (!assignmentId || !studentId || !studentName || !className) {
      throw new Error('Something went wrong loading your details. Please refresh the page and try again.')
    }

    // Same field name the n8n-hosted form itself submits, so the workflow
    // behind the webhook doesn't need to know the difference.
    const forward = new FormData()
    forward.append('Select Student', `${studentName} | Class ${className}`)
    forward.append('Homework File', file, file.name)

    const formQueryParameters = new URLSearchParams({ portion, class: className, folder, worksheet })

    // Best-effort: a failure to log a failure shouldn't itself become a
    // student-facing error, so this never throws.
    async function logFailure(status: string, errorMessage: string, detail?: Record<string, unknown>) {
      try {
        const { error } = await admin.from('worksheet_submission_logs').insert({
          assignment_id: assignmentId || null,
          student_id: studentId || null,
          student_name: studentName || null,
          class: className || null,
          subject: subject || null,
          file_name: file.name,
          source: 'edge_function',
          status,
          error_message: errorMessage.slice(0, 2000),
          detail: detail ?? null,
        })
        if (error) console.error('worksheet_submission_logs insert failed:', error)
      } catch (err) {
        console.error('worksheet_submission_logs insert threw:', err)
      }
    }

    async function gradeAndRecord(n8nResp: Response): Promise<GradeResult> {
      if (!n8nResp.ok) {
        const body = await n8nResp.text().catch(() => '')
        console.error(`n8n webhook rejected the upload (${n8nResp.status}): ${body.slice(0, 300)}`)
        await logFailure('server_error', `n8n webhook returned ${n8nResp.status}`, { status: n8nResp.status, body: body.slice(0, 300) })
        return { status: 'error', message: 'We could not process your file right now. Please try again in a few minutes.' }
      }

      const n8nBody = await n8nResp.json().catch(() => null)
      const feedbackText = extractFeedbackText(n8nBody)

      if (feedbackText && feedbackText.trim().toLowerCase() === 'no feedback') {
        await logFailure('rejected_unreadable', 'n8n graded the file but could not read the scan ("no feedback")')
        return { status: 'rejected', message: 'We could not read your handwriting clearly from this scan. Please retake a clear, well-lit photo (or a straight scan) and submit again.' }
      }

      const { error: upsertErr } = await admin
        .from('assignment_submissions')
        .upsert(
          {
            assignment_id: assignmentId,
            student_id: studentId,
            student_name: studentName,
            file_name: file.name,
            submitted_at: new Date().toISOString(),
          },
          { onConflict: 'assignment_id,student_id' }
        )
      if (upsertErr) {
        console.error('assignment_submissions upsert failed:', upsertErr)
        await logFailure('db_upsert_failed', upsertErr.message, { table: 'assignment_submissions', code: upsertErr.code })
        return { status: 'error', message: 'We could not save your submission. Please try again in a moment. If this keeps happening, let your teacher know.' }
      }

      if (feedbackText) {
        const { handwriting, rest } = splitFeedback(feedbackText)
        const context = `[${assignmentName}, Class ${className}, ${subject}]`
        const { error: feedbackErr } = await admin
          .from('worksheet_feedback')
          .upsert(
            {
              assignment_id: assignmentId,
              student_id: studentId,
              student_name: studentName,
              class: Number(className),
              subject,
              assignment_name: assignmentName,
              handwriting_feedback: handwriting ? `${context} ${handwriting}` : null,
              assignment_feedback: rest ? `${context} ${rest}` : null,
              submitted_at: new Date().toISOString(),
            },
            { onConflict: 'assignment_id,student_id' }
          )
        if (feedbackErr) {
          console.error('worksheet_feedback upsert failed:', feedbackErr)
          await logFailure('db_upsert_failed', feedbackErr.message, { table: 'worksheet_feedback', code: feedbackErr.code })
          return { status: 'error', message: 'We could not save your submission. Please try again in a moment. If this keeps happening, let your teacher know.' }
        }
      }

      return { status: 'ok' }
    }

    const n8nController = new AbortController()
    const n8nTimeout = setTimeout(() => n8nController.abort(), N8N_TIMEOUT_MS)
    const n8nPromise = fetch(`${N8N_WEBHOOK_URL}?${formQueryParameters.toString()}`, {
      method: 'POST',
      body: forward,
      signal: n8nController.signal,
    }).finally(() => clearTimeout(n8nTimeout))

    const gradePromise: Promise<GradeResult> = n8nPromise.then(gradeAndRecord).catch(async (err) => {
      const isAbort = err instanceof Error && err.name === 'AbortError'
      await logFailure(
        isAbort ? 'timeout_no_response' : 'exception',
        err instanceof Error ? err.message : String(err),
      )
      const message = isAbort
        ? 'This is taking longer than usual. Please wait a minute, then try submitting again.'
        : (err?.message || 'Something went wrong while submitting. Please try again.')
      console.error('n8n grading call failed:', err)
      return { status: 'error', message } as GradeResult
    })

    // Keep grading running even after we respond, if it comes to that.
    if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(gradePromise)

    const race = await Promise.race([
      gradePromise.then((result) => ({ timedOut: false as const, result })),
      new Promise<{ timedOut: true }>((resolve) => setTimeout(() => resolve({ timedOut: true }), FAST_PATH_MS)),
    ])

    if (race.timedOut) {
      return new Response(JSON.stringify({ ok: true, pending: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (race.result.status === 'ok') {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    return fail(race.result.message)
  } catch (err) {
    console.error('submit-worksheet failed:', err)
    return fail(err.message || 'Something went wrong while submitting. Please try again.')
  }
})
