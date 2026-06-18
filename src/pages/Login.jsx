import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

const GOLD = '#c8860a'
const NAV  = '#2d1200'
const DARK = '#1a0800'

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

  const inputStyle = {
    background: 'rgba(10,3,0,0.6)',
    border: '1px solid rgba(200,134,10,0.25)',
    color: '#f5ede0',
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: '#1a0800' }}>
      <div className="rounded-2xl shadow-2xl w-full max-w-md p-5 sm:p-8" style={{ background: '#2d1200', border: '1px solid rgba(200,134,10,0.2)' }}>
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: GOLD }}>
            <span className="text-3xl font-black text-white">S</span>
          </div>
          <h1 className="text-2xl font-bold" style={{ color: '#f5ede0' }}>Saraswati VidyaMandir</h1>
          <p className="text-sm mt-1" style={{ color: '#9a7040' }}>Student Report Portal</p>
        </div>

        {/* Tabs */}
        <div className="flex mb-6" style={{ borderBottom: '1px solid rgba(200,134,10,0.2)' }}>
          {[
            { key: 'student', label: '🎓 Student' },
            { key: 'teacher', label: '👨‍🏫 Teacher' },
          ].map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => { setRole(key); setError(''); setPassword('') }}
              className="flex-1 py-3 text-sm font-semibold transition-all border-b-2 -mb-px"
              style={role === key
                ? { borderColor: GOLD, color: GOLD }
                : { borderColor: 'transparent', color: '#7a5030' }
              }
            >
              {label}
            </button>
          ))}
        </div>

        {forgotMode ? (
          resetSent ? (
            <div className="text-center space-y-4">
              <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto" style={{ background: 'rgba(200,134,10,0.15)' }}>
                <span className="text-2xl">📧</span>
              </div>
              <p className="font-semibold" style={{ color: '#f5ede0' }}>Reset link sent!</p>
              <p className="text-sm" style={{ color: '#9a7040' }}>Check <span className="font-medium" style={{ color: '#d4b483' }}>{email}</span> for the password reset link.</p>
              <button
                onClick={() => { setForgotMode(false); setResetSent(false); setError('') }}
                className="text-sm font-medium"
                style={{ color: GOLD }}
              >
                ← Back to Login
              </button>
            </div>
          ) : (
            <form onSubmit={handleForgotPassword} className="space-y-4">
              <p className="text-sm" style={{ color: '#9a7040' }}>Enter your teacher email and we'll send a password reset link.</p>
              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: '#d4b483' }}>Teacher Email</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@saraswatividyamandir.com"
                  className="w-full px-4 py-3 rounded-lg focus:outline-none"
                  style={inputStyle}
                  onFocus={(e) => e.target.style.boxShadow = '0 0 0 2px #c8860a40'}
                  onBlur={(e) => e.target.style.boxShadow = ''}
                />
              </div>
              {error && (
                <div className="rounded-lg px-4 py-3 text-sm" style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)', color: '#f87171' }}>{error}</div>
              )}
              <button
                type="submit"
                disabled={loading}
                className="w-full text-white font-semibold py-3 rounded-lg transition-all"
                style={{ background: loading ? '#a06d08' : GOLD }}
                onMouseEnter={(e) => { if (!loading) e.currentTarget.style.background = '#a06d08' }}
                onMouseLeave={(e) => { if (!loading) e.currentTarget.style.background = GOLD }}
              >
                {loading ? 'Sending…' : 'Send Reset Link'}
              </button>
              <button
                type="button"
                onClick={() => { setForgotMode(false); setError('') }}
                className="w-full text-sm font-medium py-2"
                style={{ color: GOLD }}
              >
                ← Back to Login
              </button>
            </form>
          )
        ) : (
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: '#d4b483' }}>
                Email Address
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={role === 'student' ? 'your@gmail.com' : 'admin@saraswatividyamandir.com'}
                className="w-full px-4 py-3 rounded-lg focus:outline-none"
                style={inputStyle}
                onFocus={(e) => e.target.style.boxShadow = '0 0 0 2px #c8860a40'}
                onBlur={(e) => e.target.style.boxShadow = ''}
              />
            </div>

            {role === 'teacher' && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-sm font-medium" style={{ color: '#d4b483' }}>Password</label>
                  <button
                    type="button"
                    onClick={() => { setForgotMode(true); setError('') }}
                    className="text-xs font-medium"
                    style={{ color: GOLD }}
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
                  className="w-full px-4 py-3 rounded-lg focus:outline-none"
                  style={inputStyle}
                  onFocus={(e) => e.target.style.boxShadow = '0 0 0 2px #c8860a40'}
                  onBlur={(e) => e.target.style.boxShadow = ''}
                />
              </div>
            )}

            {role === 'student' && (
              <p className="text-xs" style={{ color: '#9a7040' }}>
                Enter the email address linked to your account. No password required.
              </p>
            )}

            {error && (
              <div className="rounded-lg px-4 py-3 text-sm" style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)', color: '#f87171' }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full text-white font-semibold py-3 rounded-lg transition-all"
              style={{ background: loading ? '#a06d08' : GOLD }}
              onMouseEnter={(e) => { if (!loading) e.currentTarget.style.background = '#a06d08' }}
              onMouseLeave={(e) => { if (!loading) e.currentTarget.style.background = GOLD }}
            >
              {loading ? 'Checking…' : 'Login'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
