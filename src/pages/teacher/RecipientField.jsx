import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { GOLD, inputClass, focusGold, blurGold } from './formStyles'
import { useOtpExpiry, formatOtpCountdown } from '../../lib/useOtpExpiry'

// Same send-action-otp/verify-action-otp pair TeacherDashboard already uses
// to gate delete-student/delete-test/reopen-submissions — 'change-report-recipient'
// must be a known purpose in supabase/functions/send-action-otp/index.ts.
const CHANGE_RECIPIENT_OTP_PURPOSE = 'change-report-recipient'
const OTP_RESEND_COOLDOWN = 45 // seconds, must match send-action-otp's cooldown

// Recipient is locked by default — changing it requires an OTP emailed to
// the logged-in teacher's own account, same gate TeacherDashboard uses for
// delete-student/delete-test/etc. Shared by both Add Exams tabs (App/Sheet)
// so the lock behaves identically everywhere it appears.
export default function RecipientField({ recipient, onChange, teacherEmail }) {
  const [changingRecipient, setChangingRecipient] = useState(false)
  const [newRecipient, setNewRecipient] = useState('')
  const [otpStep, setOtpStep] = useState('idle') // 'idle' | 'sent'
  const [otpCode, setOtpCode] = useState('')
  const [otpSending, setOtpSending] = useState(false)
  const [otpVerifying, setOtpVerifying] = useState(false)
  const [otpError, setOtpError] = useState('')
  const [otpCooldown, setOtpCooldown] = useState(0)
  const cooldownRef = useRef(null)
  const { expiresIn, startExpiry } = useOtpExpiry()
  useEffect(() => () => clearInterval(cooldownRef.current), [])

  function startOtpCooldown() {
    setOtpCooldown(OTP_RESEND_COOLDOWN)
    clearInterval(cooldownRef.current)
    cooldownRef.current = setInterval(() => {
      setOtpCooldown((c) => {
        if (c <= 1) { clearInterval(cooldownRef.current); return 0 }
        return c - 1
      })
    }, 1000)
  }

  function openChangeRecipient() {
    setChangingRecipient(true)
    setNewRecipient('')
    setOtpStep('idle')
    setOtpCode('')
    setOtpError('')
  }

  function cancelChangeRecipient() {
    setChangingRecipient(false)
    setOtpStep('idle')
    setOtpCode('')
    setNewRecipient('')
    setOtpError('')
    clearInterval(cooldownRef.current)
    setOtpCooldown(0)
  }

  async function sendRecipientOtp() {
    setOtpError('')
    if (!/^\S+@\S+\.\S+$/.test(newRecipient.trim())) {
      setOtpError('Enter a valid email address.')
      return
    }
    setOtpSending(true)
    const { data, error: fnErr } = await supabase.functions.invoke('send-action-otp', {
      body: { purpose: CHANGE_RECIPIENT_OTP_PURPOSE },
    })
    setOtpSending(false)
    if (fnErr || data?.ok === false) {
      setOtpError(data?.error || fnErr?.message || 'Failed to send code.')
      return
    }
    setOtpCode('')
    startOtpCooldown()
    startExpiry()
    setOtpStep('sent')
  }

  async function verifyRecipientOtp() {
    setOtpError('')
    setOtpVerifying(true)
    const { data, error: fnErr } = await supabase.functions.invoke('verify-action-otp', {
      body: { code: otpCode.trim(), purpose: CHANGE_RECIPIENT_OTP_PURPOSE },
    })
    setOtpVerifying(false)
    if (fnErr || data?.ok === false) {
      setOtpError(data?.error || fnErr?.message || 'Invalid or expired code.')
      return
    }
    onChange(newRecipient.trim())
    cancelChangeRecipient()
  }

  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1.5">Send report to</p>
      {!changingRecipient ? (
        <div className="flex items-center gap-2">
          <input type="email" value={recipient} disabled readOnly
            className={`${inputClass} opacity-60 cursor-not-allowed`} />
          <button type="button" onClick={openChangeRecipient}
            className="text-xs font-semibold whitespace-nowrap flex-shrink-0" style={{ color: GOLD }}
          >
            🔒 Change
          </button>
        </div>
      ) : (
        <div className="rounded-lg border p-3 space-y-2" style={{ borderColor: 'rgba(200,134,10,0.25)', background: 'rgba(200,134,10,0.06)' }}>
          {otpStep === 'idle' ? (
            <>
              <input type="email" placeholder="New recipient email" value={newRecipient} autoFocus
                onChange={(e) => setNewRecipient(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') sendRecipientOtp() }}
                className={inputClass} onFocus={focusGold} onBlur={blurGold}
              />
              <p className="text-[11px] text-gray-500">
                A confirmation code will be emailed to your account{teacherEmail ? ` (${teacherEmail})` : ''} to approve this change.
              </p>
              {otpError && <p className="text-xs text-red-500">{otpError}</p>}
              <div className="flex gap-2">
                <button type="button" onClick={sendRecipientOtp} disabled={otpSending}
                  className="text-xs font-semibold px-3 py-1.5 rounded-lg text-white transition disabled:opacity-50"
                  style={{ background: GOLD }}
                >
                  {otpSending ? 'Sending…' : 'Send Code'}
                </button>
                <button type="button" onClick={cancelChangeRecipient}
                  className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-gray-100 transition" style={{ color: 'var(--text)' }}
                >
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="text-xs text-gray-500">
                Enter the 6-digit code sent to{teacherEmail ? ` ${teacherEmail}` : ' your account'} to confirm changing the recipient to <span className="font-medium">{newRecipient.trim()}</span>.
              </p>
              <input type="text" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoFocus
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                onKeyDown={(e) => { if (e.key === 'Enter' && otpCode.length === 6) verifyRecipientOtp() }}
                placeholder="123456"
                className={`${inputClass} tracking-[0.3em] text-center`} onFocus={focusGold} onBlur={blurGold}
              />
              <p className="text-[11px]" style={{ color: expiresIn > 0 ? undefined : '#dc2626' }}>
                {expiresIn > 0 ? `Code expires in ${formatOtpCountdown(expiresIn)}` : 'Code expired — resend a new one'}
              </p>
              {otpError && <p className="text-xs text-red-500">{otpError}</p>}
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" onClick={verifyRecipientOtp} disabled={otpCode.length !== 6 || otpVerifying || expiresIn === 0}
                  className="text-xs font-semibold px-3 py-1.5 rounded-lg text-white transition disabled:opacity-50"
                  style={{ background: GOLD }}
                >
                  {otpVerifying ? 'Verifying…' : 'Verify & Update'}
                </button>
                <button type="button" onClick={sendRecipientOtp} disabled={otpCooldown > 0 || otpSending}
                  className="text-xs font-medium disabled:text-gray-400" style={{ color: otpCooldown > 0 ? undefined : GOLD }}
                >
                  {otpCooldown > 0 ? `Resend code in ${otpCooldown}s` : 'Resend code'}
                </button>
                <button type="button" onClick={cancelChangeRecipient} className="text-xs font-semibold" style={{ color: 'var(--text)' }}>
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
