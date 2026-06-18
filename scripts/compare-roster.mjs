import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'https://cexbpkbadthoqbruyjdg.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNleGJwa2JhZHRob3FicnV5amRnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgyMzA5MjMsImV4cCI6MjA5MzgwNjkyM30.lOU0y9NXbJX86t9CQRv5kgLyKGngezO7pUUhYr2eFnA'
)

const roster = {
  9: [
    'Aabhav Aggarwal', 'Aanya Aggarwal', 'Aarav Bansal', 'Aashi Gupta', 'Aashray Maken',
    'Adaa Kataria', 'Adhiraj Dhall', 'Agamya Saini', 'Akshat Singh', 'Ameya Goel',
    'Anay Arora', 'Arnav Goel', 'Arnav Saxena', 'Arnav Mehndiratta', 'Atharv Aggarwal',
    'Avni Chhabra', 'Ayaan Guglani', 'Ayaan Singh', 'Ayush Kumar', 'Bhavik Katoch',
    'Bhavya Chawla', 'Bhuvi Chauhan', 'Chahat Sehgal', 'Chhavi Saini', 'Daksh Julka',
    'Devishee Nayar', 'Devishi Gupta', 'Fateh Pratap Singh', 'Japnidh Singh', 'Jaskeerat Kaur',
    'Jigar', 'Jivanshi', 'Kanishk Singh', 'Kartik Gupta', 'Kavish Batra',
    'Keshav Gupta', 'Krish Aggarwal', 'Lavitra Dhawan', 'Mahir Walia', 'Mankirat Singh',
    'Mehar', 'Mukul Aggarwal', 'Pavani', 'Pavika Dhiman', 'Prasham Jain',
    'Radhika Namdev', 'Raghav Chadha', 'Ridhaan Mittal', 'Ridhi Goyal', 'Ridhi Gupta',
    'Rudra Sharma', 'Rushita Gulati', 'Saanvi Sharma', 'Saanvi Jain', 'Sarthak Sharma',
    'Shivansh Goel', 'Shreya Jain', 'Tanmay Gupta', 'Trisha Soni', 'Vedant Vashishat',
    'Vinayak Bakshi', 'Vridhi',
  ],
  10: [
    'Aadit Jain', 'Aahaan Verma', 'Aakhya Verma', 'Aarav Dutta', 'Aarish Aggarwal',
    'Aarna Khurana', 'Aarush Sahi', 'Aaryaveer', 'Adhiraj Aggarwal', 'Advik Kansal',
    'Advika Garg', 'Akshita Garg', 'Amyra Arora', 'Arhat Jain', 'Arshia Singh',
    'Bhavya Talwar', 'Daksh Devgan', 'Daksh Gupta', 'Divyanshi Chopra', 'Diya Dang',
    'Gyanda Sinha', 'Harseerat Sandhu', 'Hridaan Verma', 'Hrishita', 'Jasnoor Singh',
    'Kanhav Kochhar', 'Karanveer Singh Gill', 'Khushi', 'Madhav Manan', 'Meher Judge',
    'Naisha', 'Namya Gogia', 'Navika Kohli', 'Nishchay Jain', 'Nitya S Verma',
    'Pranav Verma', 'Pratham Sharma', 'Raghav Aggarwal', 'Reet Gupta', 'Reyhaan Sehmi',
    'Rimjhim Khurana', 'Saanvi Ahuja', 'Saara Aggarwal', 'Saarthak Monga', 'Samar Rana',
    'Samarth Aggarwal', 'Samrat Kaushisk', 'Shaurya Sharma', 'Shine Sharma', 'Sidak Bhardwaj',
    'Siddharth Kochhar', 'Smarth Yadav', 'Sudhan Tuli', 'Tanya Kakkar', 'Tarun',
    'Teesta', 'Vanshika Bhatnagar', 'Vidushi Aggarwal', 'Yashita Sehgal', 'Yuvansh Jain',
    'Yuvraj Singh',
  ],
}

function norm(name) {
  return name.toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim()
}

async function main() {
  const { data, error } = await supabase
    .from('student_emails')
    .select('student_id, student_name, class')
    .order('class').order('student_name')

  if (error) { console.error(error.message); process.exit(1) }

  // Deduplicate DB by student_id (multiple email rows → one student)
  const dbMap = {}
  for (const row of data) {
    if (!dbMap[row.student_id]) dbMap[row.student_id] = { id: row.student_id, name: row.student_name, class: row.class }
  }
  const dbStudents = Object.values(dbMap)

  for (const cls of [9, 10]) {
    const rosterNames  = roster[cls]
    const rosterNorms  = rosterNames.map(norm)
    const dbInClass    = dbStudents.filter((s) => s.class === cls)
    const dbNorms      = dbInClass.map((s) => norm(s.name))

    const missingFromDB = rosterNames.filter((_, i) => !dbNorms.includes(rosterNorms[i]))
    const extraInDB     = dbInClass.filter((s) => !rosterNorms.includes(norm(s.name)))

    console.log(`\n${'═'.repeat(55)}`)
    console.log(`  CLASS ${cls}  (roster: ${rosterNames.length}  |  DB: ${dbInClass.length})`)
    console.log('═'.repeat(55))

    if (missingFromDB.length === 0) {
      console.log('  ✓ No roster students missing from DB')
    } else {
      console.log(`\n  MISSING FROM DB (${missingFromDB.length}) — in roster but not in DB:`)
      missingFromDB.forEach((n) => console.log(`    • ${n}`))
    }

    if (extraInDB.length === 0) {
      console.log('  ✓ No extra students in DB')
    } else {
      console.log(`\n  EXTRA IN DB (${extraInDB.length}) — in DB but not in roster:`)
      extraInDB.forEach((s) => console.log(`    • [id ${s.id}] ${s.name}`))
    }
  }
  console.log()
}

main()
