// Verifies a code sent by send-action-otp for the currently authenticated
// teacher. Unlike verify-password-otp, this has no side effect beyond
// marking the code used — it only confirms "yes, this is really the
// logged-in teacher" before the caller proceeds with a sensitive action
// (e.g. deleting a student).
//
// Deploy:
//   npx supabase functions deploy verify-action-otp --no-verify-jwt

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const MAX_ATTEMPTS = 5

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

    const { code, purpose } = await req.json()
    if (!code || !purpose) throw new Error('code and purpose are required')
    const code_hash = await hashCode(String(code).trim())

    const { data: otpRow, error: otpErr } = await admin
      .from('action_otps')
      .select('id, code_hash, expires_at, attempts, used')
      .eq('email', email)
      .eq('purpose', purpose)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (otpErr) throw otpErr

    if (!otpRow || otpRow.used) return fail('Invalid or expired code.')
    if (otpRow.attempts >= MAX_ATTEMPTS) return fail('Too many attempts. Request a new code.')
    if (new Date(otpRow.expires_at).getTime() < Date.now()) return fail('Invalid or expired code.')

    if (otpRow.code_hash !== code_hash) {
      await admin.from('action_otps').update({ attempts: otpRow.attempts + 1 }).eq('id', otpRow.id)
      return fail('Invalid or expired code.')
    }

    await admin.from('action_otps').update({ used: true }).eq('id', otpRow.id)

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return fail(err.message)
  }
})
