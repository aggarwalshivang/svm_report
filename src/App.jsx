import { useState, useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { supabase } from './lib/supabase'
import Login from './pages/Login'
import StudentDashboard from './pages/StudentDashboard'
import TeacherDashboard from './pages/TeacherDashboard'
import ResetPassword from './pages/ResetPassword'

function StudentRoute({ children }) {
  const session = JSON.parse(localStorage.getItem('svm_session') || 'null')
  if (!session || session.role !== 'student') return <Navigate to="/" replace />
  return children
}

function TeacherRoute({ children }) {
  const [status, setStatus] = useState('checking')

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setStatus(session ? 'ok' : 'denied')
    })
  }, [])

  if (status === 'checking') return null
  if (status === 'denied') return <Navigate to="/" replace />
  return children
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Login />} />
      <Route path="/student" element={<StudentRoute><StudentDashboard /></StudentRoute>} />
      <Route path="/teacher" element={<TeacherRoute><TeacherDashboard /></TeacherRoute>} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
