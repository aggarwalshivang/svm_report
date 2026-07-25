// One-time provisioning script: creates a Supabase Auth account for every
// student in `student_emails` that doesn't already have one, using a shared
// default password. Students should use "Forgot password?" on the login
// page afterwards to set their own password.
//
// Requires the PROJECT SERVICE ROLE KEY (not the anon key) — find it in
// Supabase Dashboard -> Project Settings -> API -> service_role secret.
// NEVER commit the service role key or put it in client-side code.
//
// Usage (PowerShell):
//   $env:SUPABASE_SERVICE_ROLE_KEY = "..."
//   node scripts/create-student-auth-accounts.mjs
//
// Usage (bash):
//   SUPABASE_SERVICE_ROLE_KEY=... node scripts/create-student-auth-accounts.mjs

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://cexbpkbadthoqbruyjdg.supabase.co'
const DEFAULT_PASSWORD = 'Svm@2026'

const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!serviceRoleKey) {
  console.error('Missing SUPABASE_SERVICE_ROLE_KEY environment variable.')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

async function main() {
  const { data: students, error } = await supabase
    .from('student_emails')
    .select('student_id, student_name, email')
    .order('student_id', { ascending: true })

  if (error) {
    console.error('Failed to fetch students:', error.message)
    process.exit(1)
  }

  const seen = new Set()
  let created = 0
  let skipped = 0
  let failed = 0

  for (const student of students) {
    const email = student.email?.trim().toLowerCase()
    if (!email || seen.has(email)) { skipped++; continue }
    seen.add(email)

    const { error: createErr } = await supabase.auth.admin.createUser({
      email,
      password: DEFAULT_PASSWORD,
      email_confirm: true,
      user_metadata: { role: 'student', student_id: student.student_id, student_name: student.student_name },
    })

    if (createErr) {
      // Already exists — not a failure, just skip.
      if (createErr.message?.toLowerCase().includes('already been registered') ||
          createErr.message?.toLowerCase().includes('already exists')) {
        skipped++
        continue
      }
      console.error(`Failed for ${email} (student_id ${student.student_id}): ${createErr.message}`)
      failed++
      continue
    }

    created++
    console.log(`Created auth account for ${email} (student_id ${student.student_id})`)
  }

  console.log('\n--- Summary ---')
  console.log(`Created: ${created}`)
  console.log(`Skipped (already existed / duplicate): ${skipped}`)
  console.log(`Failed: ${failed}`)
  console.log(`\nDefault password for newly created accounts: ${DEFAULT_PASSWORD}`)
  console.log('Tell students to log in once and use "Forgot password?" to set their own.')
}

main()
