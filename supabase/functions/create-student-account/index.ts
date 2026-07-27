// Creates a Supabase Auth account (default password) for a newly added student
// so they can log in immediately, without exposing the service-role key to
// the browser. Called from TeacherDashboard's "Add Student" / "Add Email" flows.
//
// Deploy:
//   npx supabase login
//   npx supabase link --project-ref cexbpkbadthoqbruyjdg
//   npx supabase secrets set STUDENT_DEFAULT_PASSWORD=Svm@2026
//   npx supabase functions deploy create-student-account --no-verify-jwt

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const DEFAULT_PASSWORD = Deno.env.get('STUDENT_DEFAULT_PASSWORD') ?? 'Svm@2026'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  try {
    // Only a logged-in teacher may trigger account creation.
    const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '')
    if (!token) throw new Error('Missing Authorization header')
    const { data: caller, error: callerErr } = await admin.auth.getUser(token)
    if (callerErr || !caller?.user) throw new Error('Not authenticated')

    const { email, student_id, student_name } = await req.json()
    if (!email || !student_id) throw new Error('email and student_id are required')

    const { error: createErr } = await admin.auth.admin.createUser({
      email: String(email).trim().toLowerCase(),
      password: DEFAULT_PASSWORD,
      email_confirm: true,
      user_metadata: { role: 'student', student_id, student_name },
    })

    if (createErr) {
      const msg = createErr.message?.toLowerCase() ?? ''
      const alreadyExists = msg.includes('already been registered') || msg.includes('already exists')
      if (!alreadyExists) throw createErr
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
