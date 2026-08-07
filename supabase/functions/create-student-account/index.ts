// Creates a Supabase Auth account for a newly added student and emails them
// step-by-step instructions for setting their own password via Login.jsx's
// "Forgot password?" flow (send-password-otp + verify-password-otp). This
// email carries no OTP code itself — it just tells them how to get one.
// Accounts are created with a random, unknown password — nobody knows it
// until the recipient sets their own. Called from TeacherDashboard's
// "Create Dashboard" button.
//
// The confirmation email is sent via the n8n mail-confirmation-report
// webhook, NOT Resend (Resend is still used elsewhere, e.g. OTP emails).
//
// Deploy:
//   npx supabase login
//   npx supabase link --project-ref cexbpkbadthoqbruyjdg
//   npx supabase functions deploy create-student-account --no-verify-jwt

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const N8N_MAIL_WEBHOOK_URL = 'https://n8n.saraswatividyamandir.com/webhook/mail-confirmation-report'

const LOGIN_URL = 'https://report.saraswatividyamandir.com/'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function randomPassword() {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
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
    // Only a logged-in teacher may trigger account creation.
    const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '')
    if (!token) throw new Error('Missing Authorization header')
    const { data: caller, error: callerErr } = await admin.auth.getUser(token)
    if (callerErr || !caller?.user) throw new Error('Not authenticated')

    const { email, student_id, student_name } = await req.json()
    if (!email || !student_id) throw new Error('email and student_id are required')
    const normalizedEmail = String(email).trim().toLowerCase()

    const { error: createErr } = await admin.auth.admin.createUser({
      email: normalizedEmail,
      password: randomPassword(), // unknown to everyone — set later via "Forgot password?"
      email_confirm: true,
      // app_metadata (not user_metadata) — only the service role can set it, so a
      // student can't self-elevate by editing their own metadata from the browser.
      // RLS policies on student_emails/student_scores/assignments key off this claim.
      app_metadata: { role: 'student', student_id, student_name },
    })

    if (createErr) {
      const msg = createErr.message?.toLowerCase() ?? ''
      const alreadyExists = msg.includes('already been registered') || msg.includes('already exists')
      if (!alreadyExists) throw createErr
    }

    const subject = 'Your Saraswati VidyaMandir dashboard is ready — here\'s how to log in'
    const body = `Hi${student_name ? ' ' + String(student_name) : ''},

Your student dashboard has been created. Follow these steps to set your password and log in:

1. Go to ${LOGIN_URL}
2. Choose Student
3. Click "Forgot password?"
4. Enter this email address (${normalizedEmail}) and click "Send Code"
5. Check this inbox for a 6-digit code and enter it, along with a new password of your choice
6. Go back to the login page and sign in with your new password

If you didn't expect this email, you can ignore it.`

    const emailResp = await fetch(N8N_MAIL_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: normalizedEmail, subject, body }),
    })
    if (!emailResp.ok) {
      const errBody = await emailResp.text()
      throw new Error(`n8n mail webhook error: ${errBody}`)
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return fail(err.message)
  }
})
