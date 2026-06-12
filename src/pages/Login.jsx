import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

const TEACHER_EMAILS = ['admin@saraswatividyamandir.com', 'aggarwal.shivang@gmail.com']
const TEACHER_PASSWORD = 'shivang123'

export default function Login() {
  const navigate = useNavigate()
  const [role, setRole] = useState('student')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleLogin(e) {
    e.preventDefault()
    setError('')
    setLoading(true)

    if (role === 'teacher') {
      if (!TEACHER_EMAILS.includes(email.trim().toLowerCase())) {
        setError('Email not recognised as a teacher account.')
        setLoading(false)
        return
      }
      if (password !== TEACHER_PASSWORD) {
        setError('Incorrect password.')
        setLoading(false)
        return
      }
      localStorage.setItem('svm_session', JSON.stringify({ role: 'teacher', email }))
      navigate('/teacher')
      return
    }

    // Student login — look up by email
    const { data, error: dbErr } = await supabase
      .from('student_emails')
      .select('student_id, student_name, class')
      .eq('email', email.trim().toLowerCase())
      .limit(1)
      .maybeSingle()

    if (dbErr) {
      console.error('Supabase error:', dbErr)
      setError(`DB error: ${dbErr.message}`)
      setLoading(false)
      return
    }
    if (!data) {
      setError('Email not found. Please check and try again.')
      setLoading(false)
      return
    }

    localStorage.setItem(
      'svm_session',
      JSON.stringify({
        role: 'student',
        studentId: data.student_id,
        studentName: data.student_name,
        class: data.class,
        email: email.trim().toLowerCase(),
      })
    )
    navigate('/student')
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: 'linear-gradient(135deg, #1a0800 0%, #3d1a00 60%, #2a1000 100%)' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-5 sm:p-8">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: '#c8860a' }}>
            <span className="text-white text-2xl font-bold">SVM</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-800">Saraswati Vidya Mandir</h1>
          <p className="text-gray-500 mt-1">Student Report Portal</p>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200 mb-6">
          {[
            { key: 'student', label: '🎓 Student' },
            { key: 'teacher', label: '👨‍🏫 Teacher' },
          ].map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => { setRole(key); setError(''); setPassword('') }}
              className={`flex-1 py-3 text-sm font-semibold transition-all border-b-2 -mb-px ${
                role === key
                  ? 'border-[#c8860a] text-[#c8860a]'
                  : 'border-transparent text-gray-400 hover:text-gray-600'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Email Address
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={role === 'student' ? 'your@gmail.com' : 'admin@saraswatividyamandir.com'}
              className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 text-gray-800"
              style={{ '--tw-ring-color': '#c8860a' }}
              onFocus={(e) => e.target.style.boxShadow = '0 0 0 2px #c8860a40'}
              onBlur={(e) => e.target.style.boxShadow = ''}
            />
          </div>

          {role === 'teacher' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Password
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:outline-none text-gray-800"
                onFocus={(e) => e.target.style.boxShadow = '0 0 0 2px #c8860a40'}
                onBlur={(e) => e.target.style.boxShadow = ''}
              />
            </div>
          )}

          {role === 'student' && (
            <p className="text-xs text-gray-400">
              Enter the email address linked to your account. No password required.
            </p>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-600 rounded-lg px-4 py-3 text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full text-white font-semibold py-3 rounded-lg transition-all"
            style={{ background: loading ? '#a06d08' : '#c8860a' }}
            onMouseEnter={(e) => { if (!loading) e.target.style.background = '#a06d08' }}
            onMouseLeave={(e) => { if (!loading) e.target.style.background = '#c8860a' }}
          >
            {loading ? 'Checking…' : 'Login'}
          </button>
        </form>
      </div>
    </div>
  )
}
