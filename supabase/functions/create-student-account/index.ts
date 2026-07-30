// Creates a Supabase Auth account for a newly added student and emails them a
// one-time code so they can set their own password, via Login.jsx's "Forgot
// password" flow (verified by verify-password-otp). Accounts are created with
// a random, unknown password — nobody but the student ever sets it. Called
// from TeacherDashboard's "Create Dashboard" button.
//
// Deploy:
//   npx supabase login
//   npx supabase link --project-ref cexbpkbadthoqbruyjdg
//   npx supabase secrets set RESEND_API_KEY=... RESEND_FROM="Saraswati VidyaMandir <no-reply@otp.saraswatividyamandir.com>"
//   npx supabase functions deploy create-student-account --no-verify-jwt

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!
const RESEND_FROM = Deno.env.get('RESEND_FROM') ?? 'Saraswati VidyaMandir <no-reply@otp.saraswatividyamandir.com>'

const OTP_TTL_MS = 10 * 60 * 1000 // code valid for 10 minutes
const RESEND_COOLDOWN_MS = 45 * 1000 // must wait 45s between sends
const MAX_SENDS_PER_HOUR = 5

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function randomPassword() {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function hashCode(code: string) {
  const bytes = new TextEncoder().encode(code)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
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
      password: randomPassword(), // unknown to everyone — the student sets their own via the emailed code
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

    // Rate-limit welcome emails the same way send-password-otp rate-limits resets.
    const now = Date.now()
    const { data: recent, error: recentErr } = await admin
      .from('password_reset_otps')
      .select('created_at')
      .eq('email', normalizedEmail)
      .order('created_at', { ascending: false })
      .limit(MAX_SENDS_PER_HOUR)
    if (recentErr) throw recentErr

    if (recent?.[0] && now - new Date(recent[0].created_at).getTime() < RESEND_COOLDOWN_MS) {
      return fail('An email was just sent to this address. Please wait before retrying.', 429)
    }
    const sentInLastHour = (recent ?? []).filter((r) => now - new Date(r.created_at).getTime() < 60 * 60 * 1000)
    if (sentInLastHour.length >= MAX_SENDS_PER_HOUR) {
      return fail('Too many emails sent to this address recently. Try again later.', 429)
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString()
    const code_hash = await hashCode(code)
    const expires_at = new Date(now + OTP_TTL_MS).toISOString()

    const { error: insertErr } = await admin
      .from('password_reset_otps')
      .insert({ email: normalizedEmail, code_hash, expires_at })
    if (insertErr) throw insertErr

    const emailResp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: RESEND_FROM,
        to: [normalizedEmail],
        subject: 'Your Saraswati VidyaMandir dashboard is ready — set your password',
        html: `<p>Hi${student_name ? ' ' + String(student_name) : ''},</p>
               <p>Your student dashboard has been created. Use the code below to set your own password:</p>
               <p style="font-size:28px;font-weight:bold;letter-spacing:4px;">${code}</p>
               <p>Go to the login page, choose <strong>Student</strong>, click <strong>Forgot password?</strong>, enter your email and this code, then choose a password.</p>
               <p>This code expires in 10 minutes. If you didn't expect this email, you can ignore it.</p>`,
      }),
    })
    if (!emailResp.ok) {
      const body = await emailResp.text()
      throw new Error(`Resend error: ${body}`)
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return fail(err.message)
  }
})
