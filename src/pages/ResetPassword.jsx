import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function ResetPassword() {
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)

  useEffect(() => {
    // Supabase fires PASSWORD_RECOVERY when the reset link hash is detected
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setReady(true)
    })
    return () => subscription.unsubscribe()
  }, [])

  async function handleReset(e) {
    e.preventDefault()
    setError('')
    if (password !== confirm) { setError('Passwords do not match.'); return }
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return }
    setLoading(true)
    const { error: updateErr } = await supabase.auth.updateUser({ password })
    setLoading(false)
    if (updateErr) { setError(updateErr.message); return }
    navigate('/')
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: 'linear-gradient(135deg, #1a0800 0%, #3d1a00 60%, #2a1000 100%)' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-5 sm:p-8">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: '#c8860a' }}>
            <span className="text-white text-2xl font-bold">SVM</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-800">Set New Password</h1>
          <p className="text-gray-500 mt-1">Choose a new password for your account</p>
        </div>

        {!ready ? (
          <p className="text-center text-sm text-gray-400">Verifying reset link…</p>
        ) : (
          <form onSubmit={handleReset} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">New Password</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Min. 6 characters"
                className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:outline-none text-gray-800"
                onFocus={(e) => e.target.style.boxShadow = '0 0 0 2px #c8860a40'}
                onBlur={(e) => e.target.style.boxShadow = ''}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Confirm Password</label>
              <input
                type="password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Repeat new password"
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
              {loading ? 'Saving…' : 'Update Password'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
