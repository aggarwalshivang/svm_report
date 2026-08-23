// Lets a teacher open a specific student's dashboard as that student, for
// support/verification purposes — without ever knowing or resetting the
// student's real password (which create-student-account sets to something
// random and never surfaces to the teacher). Mints a one-time Supabase
// magic-link token server-side, using the service role; the frontend then
// calls supabase.auth.verifyOtp({ email, token, type: 'magiclink' }) to
// establish a real session carrying the student's actual app_metadata
// claims (student_id, role: 'student'), so it's indistinguishable from the
// student having logged in themselves and RLS applies exactly as normal.
//
// Deploy:
//   npx supabase functions deploy impersonate-student --no-verify-jwt

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
    // Only an authenticated *teacher* may impersonate a student — unlike
    // some of this project's other admin functions, this one explicitly
    // checks app_metadata.role (service-role-only, can't be forged by the
    // caller) rather than just "is logged in", since this grants full
    // access to another person's account.
    const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '')
    if (!token) throw new Error('Missing Authorization header')
    const { data: caller, error: callerErr } = await admin.auth.getUser(token)
    if (callerErr || !caller?.user) throw new Error('Not authenticated')
    if (caller.user.app_metadata?.role !== 'teacher') throw new Error('Only teachers can do this')

    const { student_id } = await req.json()
    const studentId = Number(student_id)
    if (!Number.isFinite(studentId)) throw new Error('student_id is required')

    const { data: roster, error: rosterErr } = await admin
      .from('student_emails')
      .select('email, student_name, class')
      .eq('student_id', studentId)
      .limit(1)
      .maybeSingle()
    if (rosterErr) throw rosterErr
    if (!roster?.email) throw new Error('Student not found')

    const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email: roster.email,
    })
    if (linkErr) throw linkErr

    return new Response(JSON.stringify({
      ok: true,
      email: roster.email,
      token: link.properties.hashed_token,
      student_name: roster.student_name,
      class: roster.class,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return fail(err.message)
  }
})
