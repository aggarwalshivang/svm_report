// Verifies a code sent by send-password-otp and, if valid, sets the user's
// new password. Called from Login.jsx's "Forgot password" flow once the user
// has entered the code they received and a new password.
//
// Deploy:
//   npx supabase functions deploy verify-password-otp --no-verify-jwt

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
  const fail = (error: string, status = 400) =>
    new Response(JSON.stringify({ ok: false, error }), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  try {
    const { email, code, newPassword } = await req.json()
    if (!email || !code || !newPassword) throw new Error('email, code and newPassword are required')
    if (String(newPassword).length < 6) return fail('Password must be at least 6 characters.')

    const normalizedEmail = String(email).trim().toLowerCase()
    const code_hash = await hashCode(String(code).trim())

    const { data: otpRow, error: otpErr } = await admin
      .from('password_reset_otps')
      .select('id, code_hash, expires_at, attempts, used')
      .eq('email', normalizedEmail)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (otpErr) throw otpErr

    if (!otpRow || otpRow.used) return fail('Invalid or expired code.')
    if (otpRow.attempts >= MAX_ATTEMPTS) return fail('Too many attempts. Request a new code.')
    if (new Date(otpRow.expires_at).getTime() < Date.now()) return fail('Invalid or expired code.')

    if (otpRow.code_hash !== code_hash) {
      await admin.from('password_reset_otps').update({ attempts: otpRow.attempts + 1 }).eq('id', otpRow.id)
      return fail('Invalid or expired code.')
    }

    const user = await findUserByEmail(admin, normalizedEmail)
    if (!user) return fail('Invalid or expired code.')

    const { error: updateErr } = await admin.auth.admin.updateUserById(user.id, { password: newPassword })
    if (updateErr) throw updateErr

    await admin.from('password_reset_otps').update({ used: true }).eq('id', otpRow.id)

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return fail(err.message)
  }
})
