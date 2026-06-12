import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function Login() {
  const navigate = useNavigate()
  const [role, setRole] = useState('student')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [forgotMode, setForgotMode] = useState(false)
  const [resetSent, setResetSent] = useState(false)

  async function handleLogin(e) {
    e.preventDefault()
    setError('')
    setLoading(true)

    if (role === 'teacher') {
      const { data, error: authErr } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      })
      if (authErr) {
        setError('Invalid email or password.')
        setLoading(false)
        return
      }
      localStorage.setItem('svm_session', JSON.stringify({ role: 'teacher', email: data.user.email }))
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

  async function handleForgotPassword(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { error: resetErr } = await supabase.auth.resetPasswordForEmail(
      email.trim().toLowerCase(),
      { redirectTo: `${window.location.origin}/reset-password` }
    )
    setLoading(false)
    if (resetErr) { setError('Could not send reset email. Check the address and try again.'); return }
    setResetSent(true)
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

        {forgotMode ? (
          resetSent ? (
            <div className="text-center space-y-4">
              <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto" style={{ background: '#fef3d0' }}>
                <span className="text-2xl">📧</span>
              </div>
              <p className="font-semibold text-gray-800">Reset link sent!</p>
              <p className="text-sm text-gray-500">Check <span className="font-medium">{email}</span> for the password reset link.</p>
              <button
                onClick={() => { setForgotMode(false); setResetSent(false); setError('') }}
                className="text-sm font-medium"
                style={{ color: '#c8860a' }}
              >
                ← Back to Login
              </button>
            </div>
          ) : (
            <form onSubmit={handleForgotPassword} className="space-y-4">
              <p className="text-sm text-gray-500">Enter your teacher email and we'll send a password reset link.</p>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Teacher Email</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@saraswatividyamandir.com"
                  className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:outline-none text-gray-800"
                  onFocus={(e) => e.target.style.boxShadow = '0 0 0 2px #c8860a40'}
                  onBlur={(e) => e.target.style.boxShadow = ''}
                />
              </div>
              {error && (
                <div className="bg-red-50 border border-red-200 text-red-600 rounded-lg px-4 py-3 text-sm">{error}</div>
              )}
              <button
                type="submit"
                disabled={loading}
                className="w-full text-white font-semibold py-3 rounded-lg transition-all"
                style={{ background: loading ? '#a06d08' : '#c8860a' }}
                onMouseEnter={(e) => { if (!loading) e.target.style.background = '#a06d08' }}
                onMouseLeave={(e) => { if (!loading) e.target.style.background = '#c8860a' }}
              >
                {loading ? 'Sending…' : 'Send Reset Link'}
              </button>
              <button
                type="button"
                onClick={() => { setForgotMode(false); setError('') }}
                className="w-full text-sm font-medium py-2"
                style={{ color: '#c8860a' }}
              >
                ← Back to Login
              </button>
            </form>
          )
        ) : (
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
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-sm font-medium text-gray-700">Password</label>
                  <button
                    type="button"
                    onClick={() => { setForgotMode(true); setError('') }}
                    className="text-xs font-medium"
                    style={{ color: '#c8860a' }}
                  >
                    Forgot password?
                  </button>
                </div>
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
        )}
      </div>
    </div>
  )
}
