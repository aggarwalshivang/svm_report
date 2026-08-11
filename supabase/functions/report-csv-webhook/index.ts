// Public webhook for pushing a Learnyst score-export CSV into
// public.report_csv_queue, for a teacher to review/edit/upload from the
// Update Report tab (or reject) instead of manually downloading the CSV
// from email and browsing to it. Auth is a shared secret in the
// `x-api-key` header — not a Supabase user session, since the caller is
// n8n, not a logged-in teacher. Same pattern as assignment-webhook.
//
// A queue row is deleted once the teacher either uploads it (processed
// into student_scores) or rejects it — this table is a queue, not an
// archive, so nothing here needs cleaning up over time.
//
// Deploy:
//   npx supabase secrets set REPORT_CSV_WEBHOOK_KEY=<a long random string>
//   npx supabase functions deploy report-csv-webhook --no-verify-jwt
//
// n8n HTTP Request node:
//   POST https://cexbpkbadthoqbruyjdg.supabase.co/functions/v1/report-csv-webhook
//   Headers: x-api-key: <REPORT_CSV_WEBHOOK_KEY>, Content-Type: application/json
//   Body: { "filename": "User_Scores.csv", "content": "Name,Score,Total Score,Submitted On,Learner Details\n..." }
//   (content is the raw CSV text, not base64 — it's plain text, no encoding needed)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const WEBHOOK_KEY = Deno.env.get('REPORT_CSV_WEBHOOK_KEY')!

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-api-key',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const fail = (error: string, status = 400) =>
    new Response(JSON.stringify({ ok: false, error }), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  try {
    const key = req.headers.get('x-api-key') ?? ''
    if (!WEBHOOK_KEY || key !== WEBHOOK_KEY) return fail('Invalid or missing x-api-key', 401)

    const body = await req.json()
    const filename = String(body.filename ?? '').trim()
    const csvContent = String(body.content ?? '')
    if (!filename) return fail('filename is required')
    if (!csvContent.trim()) return fail('content is required')

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
    const { data, error } = await admin
      .from('report_csv_queue')
      .insert({ filename, csv_content: csvContent })
      .select('id')
      .single()
    if (error) throw error

    return new Response(JSON.stringify({ ok: true, id: data.id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return fail(err.message)
  }
})
