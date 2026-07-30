// Sends a 6-digit confirmation code, via Resend, to the currently
// authenticated teacher's own email address — used to gate sensitive actions
// (e.g. deleting a student) behind an emailed code before they happen.
// Verified by verify-action-otp. The email is always derived from the
// caller's auth token, never from the request body, so a teacher can only
// send/verify codes for their own address.
//
// Deploy:
//   npx supabase functions deploy send-action-otp --no-verify-jwt

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

// Known purposes and the copy shown in the confirmation email. Reject anything else
// so this function can't be used to send arbitrary emails.
const PURPOSE_COPY: Record<string, { subject: string; verb: string }> = {
  'delete-student': { subject: 'Confirm deleting a student', verb: 'permanently delete a student and all of their reports' },
  'delete-assignment': { subject: 'Confirm removing a worksheet', verb: 'permanently remove a worksheet and its link' },
  'delete-test': { subject: 'Confirm deleting a test', verb: 'permanently delete a test and every student’s score for it' },
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
    const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '')
    if (!token) throw new Error('Missing Authorization header')
    const { data: caller, error: callerErr } = await admin.auth.getUser(token)
    if (callerErr || !caller?.user?.email) throw new Error('Not authenticated')
    const email = caller.user.email.toLowerCase()

    const { purpose } = await req.json()
    const copy = PURPOSE_COPY[purpose]
    if (!copy) throw new Error('Unknown purpose')

    const now = Date.now()
    const { data: recent, error: recentErr } = await admin
      .from('action_otps')
      .select('created_at')
      .eq('email', email)
      .eq('purpose', purpose)
      .order('created_at', { ascending: false })
      .limit(MAX_SENDS_PER_HOUR)
    if (recentErr) throw recentErr

    if (recent?.[0] && now - new Date(recent[0].created_at).getTime() < RESEND_COOLDOWN_MS) {
      return fail('Please wait before requesting another code.', 429)
    }
    const sentInLastHour = (recent ?? []).filter((r) => now - new Date(r.created_at).getTime() < 60 * 60 * 1000)
    if (sentInLastHour.length >= MAX_SENDS_PER_HOUR) {
      return fail('Too many requests. Try again later.', 429)
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString()
    const code_hash = await hashCode(code)
    const expires_at = new Date(now + OTP_TTL_MS).toISOString()

    const { error: insertErr } = await admin
      .from('action_otps')
      .insert({ email, purpose, code_hash, expires_at })
    if (insertErr) throw insertErr

    const emailResp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: RESEND_FROM,
        to: [email],
        subject: copy.subject,
        html: `<p>Use this code to confirm you want to ${copy.verb}:</p>
               <p style="font-size:28px;font-weight:bold;letter-spacing:4px;">${code}</p>
               <p>This code expires in 10 minutes. If you didn't request this, you can ignore this email.</p>`,
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
