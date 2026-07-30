import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'https://cexbpkbadthoqbruyjdg.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNleGJwa2JhZHRob3FicnV5amRnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgyMzA5MjMsImV4cCI6MjA5MzgwNjkyM30.lOU0y9NXbJX86t9CQRv5kgLyKGngezO7pUUhYr2eFnA'
)

const { data, error } = await supabase
  .from('student_scores')
  .select('*')
  .eq('date', '2026-07-29')
  .eq('subject', 'Maths')
  .eq('class', 10)
  .order('score_obtained', { ascending: false })
console.log('count:', data?.length, error)
console.log(data.map(r => `${r.id} ${r.student_name} ${r.score_obtained}/${r.total_marks}`).join('\n'))
