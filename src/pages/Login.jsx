import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

const RESEND_COOLDOWN = 45 // seconds, must match send-password-otp's cooldown

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
  const [forgotStep, setForgotStep] = useState('closed') // closed | request | verify | done
  const [code, setCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [cooldown, setCooldown] = useState(0)
  const cooldownRef = useRef(null)

  async function handleLogin(e) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const { data: authData, error: authErr } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    })
    if (authErr) {
      setError('Invalid email or password.')
      setLoading(false)
      return
    }

    if (role === 'teacher') {
      localStorage.setItem('svm_session', JSON.stringify({ role: 'teacher', email: authData.user.email }))
      navigate('/teacher')
      return
    }

    // Student login — fetch profile by email
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
      setError('No student profile found for this email.')
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

  function startCooldown() {
    setCooldown(RESEND_COOLDOWN)
    clearInterval(cooldownRef.current)
    cooldownRef.current = setInterval(() => {
      setCooldown((c) => {
        if (c <= 1) { clearInterval(cooldownRef.current); return 0 }
        return c - 1
      })
    }, 1000)
  }

  useEffect(() => () => clearInterval(cooldownRef.current), [])

  async function sendOtp() {
    setError('')
    setLoading(true)
    const { data, error: fnErr } = await supabase.functions.invoke('send-password-otp', {
      body: { email: email.trim().toLowerCase() },
    })
    setLoading(false)
    if (fnErr || data?.ok === false) {
      setError(data?.error || 'Could not send code. Check the address and try again.')
      return false
    }
    startCooldown()
    return true
  }

  async function handleRequestOtp(e) {
    e.preventDefault()
    if (await sendOtp()) setForgotStep('verify')
  }

  async function handleResendOtp() {
    if (cooldown > 0) return
    await sendOtp()
  }

  async function handleVerifyOtp(e) {
    e.preventDefault()
    setError('')
    if (newPassword !== confirmPassword) { setError('Passwords do not match.'); return }
    if (newPassword.length < 6) { setError('Password must be at least 6 characters.'); return }
    setLoading(true)
    const { data, error: fnErr } = await supabase.functions.invoke('verify-password-otp', {
      body: { email: email.trim().toLowerCase(), code: code.trim(), newPassword },
    })
    setLoading(false)
    if (fnErr || data?.ok === false) {
      setError(data?.error || 'Invalid or expired code.')
      return
    }
    setForgotStep('done')
  }

  function resetForgotState() {
    setForgotStep('closed')
    setCode('')
    setNewPassword('')
    setConfirmPassword('')
    setCooldown(0)
    clearInterval(cooldownRef.current)
    setError('')
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

        {forgotStep === 'done' ? (
          <div className="text-center space-y-4">
            <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto" style={{ background: 'rgba(200,134,10,0.15)' }}>
              <span className="text-2xl">✅</span>
            </div>
            <p className="font-semibold" style={{ color: '#f5ede0' }}>Password updated!</p>
            <p className="text-sm" style={{ color: '#9a7040' }}>You can now log in with your new password.</p>
            <button
              onClick={resetForgotState}
              className="text-sm font-medium"
              style={{ color: GOLD }}
            >
              ← Back to Login
            </button>
          </div>
        ) : forgotStep === 'verify' ? (
          <form onSubmit={handleVerifyOtp} className="space-y-4">
            <p className="text-sm" style={{ color: '#9a7040' }}>
              Enter the 6-digit code sent to <span className="font-medium" style={{ color: '#d4b483' }}>{email}</span> and choose a new password.
            </p>
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: '#d4b483' }}>Code</label>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                placeholder="123456"
                className="w-full px-4 py-3 rounded-lg focus:outline-none tracking-[0.3em] text-center"
                style={inputStyle}
                onFocus={(e) => e.target.style.boxShadow = '0 0 0 2px #c8860a40'}
                onBlur={(e) => e.target.style.boxShadow = ''}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: '#d4b483' }}>New Password</label>
              <input
                type="password"
                required
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Min. 6 characters"
                className="w-full px-4 py-3 rounded-lg focus:outline-none"
                style={inputStyle}
                onFocus={(e) => e.target.style.boxShadow = '0 0 0 2px #c8860a40'}
                onBlur={(e) => e.target.style.boxShadow = ''}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: '#d4b483' }}>Confirm Password</label>
              <input
                type="password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Repeat new password"
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
              {loading ? 'Verifying…' : 'Reset Password'}
            </button>
            <button
              type="button"
              disabled={cooldown > 0 || loading}
              onClick={handleResendOtp}
              className="w-full text-sm font-medium py-2"
              style={{ color: cooldown > 0 ? '#7a5030' : GOLD }}
            >
              {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
            </button>
            <button
              type="button"
              onClick={resetForgotState}
              className="w-full text-sm font-medium py-2"
              style={{ color: GOLD }}
            >
              ← Back to Login
            </button>
          </form>
        ) : forgotStep === 'request' ? (
          <form onSubmit={handleRequestOtp} className="space-y-4">
            <p className="text-sm" style={{ color: '#9a7040' }}>Enter your {role === 'teacher' ? 'teacher' : 'student'} email and we'll send a 6-digit code.</p>
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: '#d4b483' }}>Email</label>
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
              {loading ? 'Sending…' : 'Send Code'}
            </button>
            <button
              type="button"
              onClick={resetForgotState}
              className="w-full text-sm font-medium py-2"
              style={{ color: GOLD }}
            >
              ← Back to Login
            </button>
          </form>
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

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-sm font-medium" style={{ color: '#d4b483' }}>Password</label>
                <button
                  type="button"
                  onClick={() => { setForgotStep('request'); setError('') }}
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
