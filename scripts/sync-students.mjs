import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'https://cexbpkbadthoqbruyjdg.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNleGJwa2JhZHRob3FicnV5amRnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgyMzA5MjMsImV4cCI6MjA5MzgwNjkyM30.lOU0y9NXbJX86t9CQRv5kgLyKGngezO7pUUhYr2eFnA'
)

// ── Students to ADD ──────────────────────────────────────────────────────────
const toAdd = [
  // Class 10
  { name: 'Aakhya Verma',       class: 10, email: 'aakhyaverma472@gmail.com' },
  { name: 'Aarav Dutta',        class: 10, email: 'aaravdutta295@gmail.com' },
  { name: 'Adhiraj Aggarwal',   class: 10, email: 'karnika2121@gmail.com' },
  { name: 'Akshita Garg',       class: 10, email: 'kanikaraman09@gmail.com' },
  { name: 'Arshia Singh',       class: 10, email: 'arshiasingh0369@gmail.com' },
  { name: 'Daksh Devgan',       class: 10, email: 'ddpdskywalker007@gmail.com' },
  { name: 'Gyanda Sinha',       class: 10, email: 'poonambhatia001@gmail.com' },
  { name: 'Harseerat Sandhu',   class: 10, email: 'amandeepharseerat@gmail.com' },
  { name: 'Hridaan Verma',      class: 10, email: 'hridaan11@gmail.com' },
  { name: 'Madhav Manan',       class: 10, email: 'mm2410.gur@kunskapsskolan.edu.in' },
  { name: 'Navika Kohli',       class: 10, email: 'neetukohli152@gmail.com' },
  { name: 'Pranav Verma',       class: 10, email: 'mamtachintu015@gmail.com' },
  { name: 'Raghav Aggarwal',    class: 10, email: 'raghavaggarwalgaming@gmail.com' },
  { name: 'Reet Gupta',         class: 10, email: 'neha.trg2703@gmail.com' },
  { name: 'Reyhaan Sehmi',      class: 10, email: 'reyhaan.sehmi@gmail.com' },
  { name: 'Saarthak Monga',     class: 10, email: 'saarthakm108@gmail.com' },
  { name: 'Samarth Aggarwal',   class: 10, email: 'samarthaggarwal2911@gmail.com' },
  { name: 'Samrat Kaushisk',    class: 10, email: 'poonamkaushish1008@gmail.com' },
  { name: 'Smarth Yadav',       class: 10, email: 'nehanehayadav04@gmail.com' },
  { name: 'Vanshika Bhatnagar', class: 10, email: 'bhatnagarvanshika13@gmail.com' },
  { name: 'Yuvraj Singh',       class: 10, email: 'yuvibatth28@gmail.com' },
  // Class 9
  { name: 'Aanya Aggarwal',     class: 9,  email: 'aanyaaggarwal32@gmail.com' },
  { name: 'Aaradhya',           class: 9,  email: 'heenaparmar.231992@gmail.com' },
  { name: 'Adaa Kataria',       class: 9,  email: 'adaakataria01@gmail.com' },
  { name: 'Ameya Goel',         class: 9,  email: 'goelameya550@gmail.com' },
  { name: 'Arnav Mehndiratta',  class: 9,  email: 'arnavmehndiratta3001@gmail.com' },
  { name: 'Ayaan Singh',        class: 9,  email: 'mrsharpreet1985@gmail.com' },
  { name: 'Chahat Sehgal',      class: 9,  email: 'chahatehgal2012@gmail.com' },
  { name: 'Fateh Partap Singh', class: 9,  email: 'fatehpartap3@gmail.com' },
  { name: 'Kanishk Singh',      class: 9,  email: 'singh14kanishk14@gmail.com' },
  { name: 'Pavika Dhiman',      class: 9,  email: 'pavikadhiman7722@gmail.com' },
  { name: 'Rudra Sharma',       class: 9,  email: 'rudra.k.s78891@gmail.com' },
  { name: 'Rushita Gulati',     class: 9,  email: 'rushita1801@gmail.com' },
  { name: 'Shivansh Goel',      class: 9,  email: 'ambala.shivansh@gmail.com' },
  { name: 'Shreya Jain',        class: 9,  email: 'shreyaisalso@gmail.com' },
  { name: 'Tanmay Gupta',       class: 9,  email: 'guptatanmay1710@gmail.com' },
  { name: 'Trisha Soni',        class: 9,  email: 'tashvisoni30@gmail.com' },
  { name: 'Vedansh Bajaj',      class: 9,  email: 'vedanshbajaj3@gmail.com' },
  { name: 'Vinayak Bakshi',     class: 9,  email: 'sbakshi583@gmail.com' },
  { name: 'Vridhi',             class: 9,  email: 'berivridhi@gmail.com' },
]

async function main() {
  // ── Step 1: fetch current max student_id ────────────────────────────────
  const { data: allStudents, error: fetchErr } = await supabase
    .from('student_emails')
    .select('student_id')

  if (fetchErr) { console.error('Fetch error:', fetchErr.message); process.exit(1) }

  const maxId = allStudents.length
    ? Math.max(...allStudents.map((s) => Number(s.student_id)))
    : 0
  console.log(`Current max student_id: ${maxId}`)

  // ── Step 2: remove Laxmi Saini (student_id 125) ─────────────────────────
  console.log('\nRemoving Laxmi Saini (student_id 125)…')
  const { error: delErr } = await supabase
    .from('student_emails')
    .delete()
    .eq('student_id', 125)

  if (delErr) {
    console.error('  ✗ Delete error:', delErr.message)
  } else {
    console.log('  ✓ Removed from student_emails')
  }

  // Note: no student_scores rows to delete unless she had scores; the caller
  // can handle that separately if needed.

  // ── Step 3: insert new students ─────────────────────────────────────────
  let nextId = maxId + 1
  console.log(`\nAdding ${toAdd.length} students starting at student_id ${nextId}…\n`)

  for (const student of toAdd) {
    const row = {
      student_id:   nextId,
      student_name: student.name,
      class:        student.class,
      email:        student.email.toLowerCase(),
    }

    const { error: insErr } = await supabase.from('student_emails').insert([row])

    if (insErr) {
      console.error(`  ✗ [${nextId}] ${student.name} — ${insErr.message}`)
    } else {
      console.log(`  ✓ [${nextId}] Class ${student.class} — ${student.name} <${student.email}>`)
    }

    nextId++
  }

  console.log('\nDone.')
}

main()
