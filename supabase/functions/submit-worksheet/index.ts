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
// Deploy:
//   npx supabase functions deploy submit-worksheet --no-verify-jwt

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const N8N_WEBHOOK_URL = 'https://n8n.saraswatividyamandir.com/webhook/student-form-worksheet'
const MAX_FILE_BYTES = 20 * 1024 * 1024

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
    if (!token) throw new Error('Missing Authorization header')
    const { data: caller, error: callerErr } = await admin.auth.getUser(token)
    if (callerErr || !caller?.user) throw new Error('Not authenticated')

    const form = await req.formData()
    const file = form.get('file')
    if (!(file instanceof File)) throw new Error('A worksheet PDF file is required')
    if (file.type !== 'application/pdf') throw new Error('Only PDF files are accepted')
    if (file.size > MAX_FILE_BYTES) throw new Error('File must be under 20 MB')

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
      throw new Error('assignment_id, student_id, student_name and class are required')
    }

    // Same field name the n8n-hosted form itself submits, so the workflow
    // behind the webhook doesn't need to know the difference.
    const forward = new FormData()
    forward.append('Select Student', `${studentName} | Class ${className}`)
    forward.append('Homework File', file, file.name)

    const formQueryParameters = new URLSearchParams({ portion, class: className, folder, worksheet })
    const n8nResp = await fetch(`${N8N_WEBHOOK_URL}?${formQueryParameters.toString()}`, {
      method: 'POST',
      body: forward,
    })
    if (!n8nResp.ok) {
      const body = await n8nResp.text().catch(() => '')
      throw new Error(`n8n webhook rejected the upload (${n8nResp.status}): ${body.slice(0, 300)}`)
    }

    const n8nBody = await n8nResp.json().catch(() => null)
    const feedbackText = extractFeedbackText(n8nBody)

    if (feedbackText && feedbackText.trim().toLowerCase() === 'no feedback') {
      return fail('Your handwriting could not be read from the scan. Please submit again with a clearer photo/scan.')
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
    if (upsertErr) throw upsertErr

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
      if (feedbackErr) throw feedbackErr
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return fail(err.message)
  }
})
