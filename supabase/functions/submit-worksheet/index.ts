// Forwards a student's worksheet PDF to the n8n "student-form-worksheet"
// webhook (same field names/query params its hosted form uses) and records
// the submission in Supabase so the student dashboard can show a
// Submitted/Missing status without needing n8n to call back.
//
// The upload goes browser -> this function -> n8n, not browser -> n8n
// directly, so we never have to deal with CORS on the n8n side.
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
    if (file.type && file.type !== 'application/pdf') throw new Error('Only PDF files are accepted')
    if (file.size > MAX_FILE_BYTES) throw new Error('File must be under 20 MB')

    const assignmentId = String(form.get('assignment_id') ?? '')
    const studentId = Number(form.get('student_id'))
    const studentName = String(form.get('student_name') ?? '').trim()
    const className = String(form.get('class') ?? '').trim()
    const portion = String(form.get('portion') ?? '')
    const folder = String(form.get('folder') ?? '')
    const worksheet = String(form.get('worksheet') ?? '')
    if (!assignmentId || !studentId || !studentName || !className) {
      throw new Error('assignment_id, student_id, student_name and class are required')
    }

    // Same field names the n8n-hosted form itself submits, so the workflow
    // behind the webhook doesn't need to know the difference.
    const forward = new FormData()
    forward.append('Select Student', `${studentName} | Class ${className}`)
    forward.append('Worksheet pdf File (Only 1 pdf file less than 20 mb)', file, file.name)

    const query = new URLSearchParams({ portion, class: className, folder, worksheet })
    const n8nResp = await fetch(`${N8N_WEBHOOK_URL}?${query.toString()}`, {
      method: 'POST',
      body: forward,
    })
    if (!n8nResp.ok) {
      const body = await n8nResp.text().catch(() => '')
      throw new Error(`n8n webhook rejected the upload (${n8nResp.status}): ${body.slice(0, 300)}`)
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

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return fail(err.message)
  }
})
