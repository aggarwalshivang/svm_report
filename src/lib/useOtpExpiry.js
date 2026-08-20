import { useEffect, useRef, useState } from 'react'

// Must match send-action-otp's OTP_TTL_MS (10 minutes).
export const OTP_TTL_SECONDS = 600

// Ticks a countdown to when a just-sent action-otp code expires, so the
// confirmation modals can show the teacher a live "Code expires in M:SS"
// instead of them finding out only after a valid-looking code is rejected.
export function useOtpExpiry() {
  const [expiresIn, setExpiresIn] = useState(0)
  const expiryRef = useRef(null)

  useEffect(() => () => clearInterval(expiryRef.current), [])

  function startExpiry() {
    setExpiresIn(OTP_TTL_SECONDS)
    clearInterval(expiryRef.current)
    expiryRef.current = setInterval(() => {
      setExpiresIn((s) => {
        if (s <= 1) { clearInterval(expiryRef.current); return 0 }
        return s - 1
      })
    }, 1000)
  }

  return { expiresIn, startExpiry }
}

export function formatOtpCountdown(totalSeconds) {
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}
