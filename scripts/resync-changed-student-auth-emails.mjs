import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'https://cexbpkbadthoqbruyjdg.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

const updates = [
  { uid: '52aa8be8-4cc0-4d7e-982c-e529c7d7ef93', name: 'Atharv Aggarwal',      email: 'atharvagg23@gmail.com' },
  { uid: 'a14785b4-3e66-4960-9335-cfd2e6ebe9a0', name: 'Anay Arora',           email: 'anaydotgmailcim1234@gmail.com' },
  { uid: '9f54b462-89b0-42a9-b032-62e1a7789c1a', name: 'Bhavya Chawla',        email: 'chawlabhavya1@gmail.com' },
  { uid: '25271318-980c-42d6-b1a5-6a07a9bd5673', name: 'Aanya Aggarwal',       email: 'aggarwalaanya826@gmail.com' },
  { uid: 'a877266d-5f2c-421d-a141-3996cba1ff4f', name: 'Ayaan Singh',          email: 'ayaansingh.official3311@gmail.com' },
  { uid: '02a58575-e194-44c0-8122-d6bee6d243c1', name: 'Ridhi Goyal',          email: 'ridhigoyal2012@gmail.com' },
  { uid: 'aeb209fd-b5e7-456d-8f65-9ac97bc26d09', name: 'Saanvi Sharma',        email: 'hereissaanvi@gmail.com' },
  { uid: '60bbe848-9877-448c-a25e-612140eae973', name: 'Radhika Namdev',       email: 'namdevradhika611@gmail.com' },
  { uid: 'bb15a49d-8122-433e-a4e6-f367e9eaade3', name: 'Meher Judge',          email: 'falconclaw1115@gmail.com' },
  { uid: '18c89fdd-1c6f-41bc-a9b3-1cfc6cd52c4a', name: 'Naisha',               email: 'naishaonly6@gmail.com' },
  { uid: '90dafc54-1f1b-43fe-a38c-4bccc70cdef8', name: 'Kanhav Kochhar',       email: 'kanhavkochhar@gmail.com' },
  { uid: '8afd0f29-a81e-4fa3-a7fa-475511856dd2', name: 'Adhiraj Aggarwal',     email: 'adhirajagg21@gmail.com' },
  { uid: '0b202fd9-fb3d-4e66-a5e4-2e28d9faa3ee', name: 'Aarush Sahi',          email: 'aarushsahi2010@gmail.com' },
  { uid: 'addc2adf-289c-4e4b-afa4-36e4b6484882', name: 'Advika Garg',          email: 'gargadvika835@gmail.com' },
  { uid: '30f4042e-50fa-4e09-918c-6a5c445d8a6e', name: 'Nishchay Jain',        email: 'nis.schayjain.n@gmail.com' },
  { uid: 'a91ce715-bdd1-493f-a3fe-dfa93414712c', name: 'Advik Kansal',         email: 'advikkansal6464@gmail.com' },
  { uid: '1ed91e2c-edba-4025-bddc-b642e97f7b52', name: 'Raghav Aggarwal',      email: 'aggarwalraghav12010@gmail.com' },
  { uid: 'b66ba9de-61dd-4f42-a937-75c21329cf5f', name: 'Tarun Pal',            email: 'palmeenu7837@gmail.com' },
  { uid: '467c0829-09a6-4fe8-ba6d-c40446cf2f5c', name: 'Namya Gogia',          email: 'namyagogia0201@gmail.com' },
  { uid: '2b0ab8e8-5031-4aa6-8784-981f3f7d1aa7', name: 'Arhat Jain',           email: 'arhatj23@gmail.com' },
  { uid: '9c752c69-51ef-4592-ae32-073f315c6e97', name: 'Pranav Verma',         email: 'prannavv015@gmail.com' },
  { uid: '219bec70-5a4a-45ce-8f42-9ee30603bdb2', name: 'Karanveer Singh Gill', email: 'karangill.og@gmail.com' },
]

let ok = 0, fail = 0
for (const u of updates) {
  const { error } = await supabase.auth.admin.updateUserById(u.uid, {
    email: u.email,
    email_confirm: true,
  })
  if (error) {
    console.error(`FAIL [${u.name}] -> ${u.email}: ${error.message}`)
    fail++
  } else {
    console.log(`OK   [${u.name}] auth email -> ${u.email}`)
    ok++
  }
}
console.log(`\nDone. ${ok} updated, ${fail} failed.`)
