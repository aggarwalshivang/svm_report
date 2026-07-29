// Public webhook for creating assignments from external automations (e.g. an
// n8n HTTP Request node). Auth is a shared secret in the `x-api-key` header —
// not a Supabase user session, since the caller isn't a logged-in teacher.
// Inserts go straight into public.assignments using the service-role key.
// Shown to teachers in the "Assignments" tab of TeacherDashboard.
//
// Deploy:
//   npx supabase secrets set ASSIGNMENT_WEBHOOK_KEY=<a long random string>
//   npx supabase functions deploy assignment-webhook --no-verify-jwt
//
// n8n HTTP Request node:
//   POST https://cexbpkbadthoqbruyjdg.supabase.co/functions/v1/assignment-webhook
//   Headers: x-api-key: <ASSIGNMENT_WEBHOOK_KEY>, Content-Type: application/json
//   Body: { "class": "9", "subject": "Maths", "assignment_name": "Chapter 4 worksheet",
//           "deadline": "2026-08-05T18:00:00+05:30",
//           "link": "https://...", "other": "Optional notes",
//           "created": "2026-08-01T10:00:00+05:30",  // optional, defaults to now
//           "portion": "Arithmetic Progressions | 10 Qs | Class 10",  // optional — used as the
//           "folder": "1C6HgTNaTd4QBYL2GtqjLZaunJ2nITBSB" }           // Google Drive folder id — both
//           // are only needed if students will submit worksheets back through the
//           // student-form-worksheet webhook for this assignment.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const WEBHOOK_KEY = Deno.env.get('ASSIGNMENT_WEBHOOK_KEY')!

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-api-key',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const fail = (error: string, status = 400) =>
    new Response(JSON.stringify({ ok: false, error }), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  try {
    const key = req.headers.get('x-api-key') ?? ''
    if (!WEBHOOK_KEY || key !== WEBHOOK_KEY) return fail('Invalid or missing x-api-key', 401)

    const body = await req.json()
    const className = String(body.class ?? '').trim()
    const subject = String(body.subject ?? '').trim()
    const title = String(body.assignment_name ?? body.title ?? '').trim()
    const link = (body.link ?? body.assignment_link) ? String(body.link ?? body.assignment_link).trim() : null
    const notesRaw = body.other ?? body.notes ?? null
    const notes = notesRaw ? String(notesRaw) : null
    const portion = body.portion ? String(body.portion).trim() : null
    const driveFolderId = body.folder ? String(body.folder).trim() : null
    const deadlineRaw = body.deadline

    if (!className || !subject || !title || !deadlineRaw) {
      return fail('class, subject, assignment_name and deadline are required')
    }
    const deadline = new Date(deadlineRaw)
    if (Number.isNaN(deadline.getTime())) return fail('deadline must be a valid date/time')

    const createdRaw = body.created ?? body.created_at
    let createdAt: string | undefined
    if (createdRaw) {
      const created = new Date(createdRaw)
      if (Number.isNaN(created.getTime())) return fail('created must be a valid date/time')
      createdAt = created.toISOString()
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
    const { data, error } = await admin
      .from('assignments')
      .insert({
        class: className, subject, title, deadline: deadline.toISOString(), link, notes,
        portion, drive_folder_id: driveFolderId,
        ...(createdAt ? { created_at: createdAt } : {}),
      })
      .select('id')
      .single()
    if (error) throw error

    return new Response(JSON.stringify({ ok: true, id: data.id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return fail(err.message)
  }
})
