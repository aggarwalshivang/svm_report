import { useState, useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { supabase } from './lib/supabase'
import Login from './pages/Login'
import StudentDashboard from './pages/StudentDashboard'
import TeacherDashboard from './pages/TeacherDashboard'

function StudentRoute({ children }) {
  const session = JSON.parse(localStorage.getItem('svm_session') || 'null')
  const validShape = !!session && session.role === 'student'
  const [status, setStatus] = useState(validShape ? 'checking' : 'denied')

  // svm_session survives indefinitely in localStorage, but the Supabase auth
  // session it rides alongside can expire/get cleared independently. Every
  // RLS-gated query below is scoped to the authenticated role, so a stale
  // auth session doesn't error — it silently returns zero rows, rendering a
  // dashboard that just looks empty. Verify the real session is still live
  // before trusting the localStorage blob.
  useEffect(() => {
    if (!validShape) return
    supabase.auth.getSession().then(({ data: { session: authSession } }) => {
      if (!authSession) { localStorage.removeItem('svm_session'); setStatus('denied'); return }
      setStatus('ok')
    })
  }, [validShape])

  if (status === 'checking') return null
  if (status === 'denied') return <Navigate to="/" replace state={{ expired: true }} />
  return children
}

function TeacherRoute({ children }) {
  const [status, setStatus] = useState('checking')

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      // app_metadata is admin/service-role-only — unlike user_metadata or the
      // localStorage session, a logged-in student can't forge this claim.
      setStatus(session?.user?.app_metadata?.role === 'teacher' ? 'ok' : 'denied')
    })
  }, [])

  if (status === 'checking') return null
  if (status === 'denied') return <Navigate to="/" replace />
  return children
}

// A returning user who's still logged in (svm_session survives indefinitely
// in localStorage, same as the Supabase auth session it rides alongside)
// should land straight on their dashboard instead of re-entering credentials.
// Teacher role is re-verified against the live Supabase session — same check
// TeacherRoute does — so a stale/forged localStorage blob can't bounce here;
// worst case it just falls through to the login form.
function RootRoute() {
  const [status, setStatus] = useState('checking') // checking | anon | student | teacher

  useEffect(() => {
    const stored = JSON.parse(localStorage.getItem('svm_session') || 'null')
    if (stored?.role === 'student') { setStatus('student'); return }
    if (stored?.role === 'teacher') {
      supabase.auth.getSession().then(({ data: { session } }) => {
        setStatus(session?.user?.app_metadata?.role === 'teacher' ? 'teacher' : 'anon')
      })
      return
    }
    setStatus('anon')
  }, [])

  if (status === 'checking') return null
  if (status === 'student') return <Navigate to="/student" replace />
  if (status === 'teacher') return <Navigate to="/teacher" replace />
  return <Login />
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<RootRoute />} />
      <Route path="/student" element={<StudentRoute><StudentDashboard /></StudentRoute>} />
      <Route path="/teacher" element={<TeacherRoute><TeacherDashboard /></TeacherRoute>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
