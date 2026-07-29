// Sends a 6-digit password-reset code to an email address via Resend, and
// records a hash of it in public.password_reset_otps for verify-password-otp
// to check. Called from Login.jsx's "Forgot password" flow (initial request
// and every "Resend code" click).
//
// Deploy:
//   npx supabase functions deploy send-password-otp --no-verify-jwt
//   npx supabase secrets set RESEND_API_KEY=... RESEND_FROM="Saraswati VidyaMandir <no-reply@otp.saraswatividyamandir.com>"

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

async function hashCode(code: string) {
  const bytes = new TextEncoder().encode(code)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function findUserByEmail(admin: ReturnType<typeof createClient>, email: string) {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw error
    const match = data.users.find((u) => u.email?.toLowerCase() === email)
    if (match) return match
    if (data.users.length < 1000) return null
  }
  return null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  // Always respond with this same shape so the response can't be used to
  // enumerate which addresses have accounts.
  const genericOk = new Response(JSON.stringify({ ok: true }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

  try {
    const { email } = await req.json()
    if (!email || typeof email !== 'string') throw new Error('email is required')
    const normalizedEmail = email.trim().toLowerCase()

    const { data: recent, error: recentErr } = await admin
      .from('password_reset_otps')
      .select('created_at')
      .eq('email', normalizedEmail)
      .order('created_at', { ascending: false })
      .limit(MAX_SENDS_PER_HOUR)
    if (recentErr) throw recentErr

    const now = Date.now()
    if (recent?.[0] && now - new Date(recent[0].created_at).getTime() < RESEND_COOLDOWN_MS) {
      return new Response(JSON.stringify({ ok: false, error: 'Please wait before requesting another code.' }), {
        status: 429,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const sentInLastHour = (recent ?? []).filter((r) => now - new Date(r.created_at).getTime() < 60 * 60 * 1000)
    if (sentInLastHour.length >= MAX_SENDS_PER_HOUR) {
      return new Response(JSON.stringify({ ok: false, error: 'Too many requests. Try again later.' }), {
        status: 429,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const user = await findUserByEmail(admin, normalizedEmail)
    if (!user) return genericOk // don't reveal whether the account exists

    const code = Math.floor(100000 + Math.random() * 900000).toString()
    const code_hash = await hashCode(code)
    const expires_at = new Date(now + OTP_TTL_MS).toISOString()

    const { error: insertErr } = await admin
      .from('password_reset_otps')
      .insert({ email: normalizedEmail, code_hash, expires_at })
    if (insertErr) throw insertErr

    const emailResp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: RESEND_FROM,
        to: [normalizedEmail],
        subject: 'Your Saraswati VidyaMandir password reset code',
        html: `<p>Your password reset code is:</p>
               <p style="font-size:28px;font-weight:bold;letter-spacing:4px;">${code}</p>
               <p>This code expires in 10 minutes. If you didn't request this, you can ignore this email.</p>`,
      }),
    })
    if (!emailResp.ok) {
      const body = await emailResp.text()
      throw new Error(`Resend error: ${body}`)
    }

    return genericOk
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
