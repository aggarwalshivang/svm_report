// Renames a student everywhere their name is stored. student_name is
// denormalized across four tables (student_emails is the roster of record;
// student_scores, assignment_submissions and worksheet_feedback each keep
// their own copy so historical rows still read correctly even if the
// roster changes later) — this function updates all four by student_id in
// one place instead of the caller having to know that.
//
// Runs with the service role because worksheet_feedback has no UPDATE
// policy for the 'authenticated' role (only submit-worksheet, itself
// service-role, writes to it) — a plain client-side .update() from the
// teacher dashboard would silently affect 0 rows there.
//
// Deploy:
//   npx supabase functions deploy rename-student --no-verify-jwt

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

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
    // Only a logged-in (teacher) session may rename a student.
    const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '')
    if (!token) throw new Error('Missing Authorization header')
    const { data: caller, error: callerErr } = await admin.auth.getUser(token)
    if (callerErr || !caller?.user) throw new Error('Not authenticated')

    const { student_id, new_name } = await req.json()
    const studentId = Number(student_id)
    const newName = String(new_name ?? '').trim()
    if (!Number.isFinite(studentId) || !newName) {
      throw new Error('student_id and new_name are required')
    }

    const { error: emailsErr } = await admin
      .from('student_emails').update({ student_name: newName }).eq('student_id', studentId)
    if (emailsErr) throw emailsErr

    const { error: scoresErr } = await admin
      .from('student_scores').update({ student_name: newName }).eq('student_id', studentId)
    if (scoresErr) throw scoresErr

    const { error: submissionsErr } = await admin
      .from('assignment_submissions').update({ student_name: newName }).eq('student_id', studentId)
    if (submissionsErr) throw submissionsErr

    const { error: feedbackErr } = await admin
      .from('worksheet_feedback').update({ student_name: newName }).eq('student_id', studentId)
    if (feedbackErr) throw feedbackErr

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return fail(err.message)
  }
})
