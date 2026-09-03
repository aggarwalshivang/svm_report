import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase'

// Drop-in replacement for supabase.functions.invoke() for the one case it
// can't serve: showing a student how much of their PDF has actually gone up.
// fetch() (what supabase-js uses internally) exposes no upload-progress
// events at all, so a multi-MB scan on a slow phone connection looks
// identical to a frozen button for a minute or more. XMLHttpRequest is the
// only browser API that reports request-body bytes as they're sent, so this
// re-implements the same call over XHR.
//
// The returned shape ({ data, error }) and the error shapes are deliberately
// identical to supabase-js's, so callers keep the same handling:
//   • network/abort failure → error.message contains 'Failed to send a
//     request to the Edge Function' (callers key their "connection dropped,
//     go verify whether it landed anyway" path off exactly this string)
//   • non-2xx → data is null and the function's JSON body is left readable
//     via error.context.json(), exactly as FunctionsHttpError does.
export function invokeWithProgress(functionName, body, { onUploadProgress, onUploaded } = {}) {
  return new Promise((resolve) => {
    // A student's Authorization token is what submit-worksheet authenticates
    // against; falling back to the anon key mirrors supabase-js for the
    // (shouldn't-happen) signed-out case, so the function returns its own
    // "session expired" message instead of this layer inventing one.
    supabase.auth.getSession().then(({ data: sessionData }) => {
      const token = sessionData?.session?.access_token || SUPABASE_ANON_KEY
      const xhr = new XMLHttpRequest()
      xhr.open('POST', `${SUPABASE_URL}/functions/v1/${functionName}`)
      xhr.setRequestHeader('Authorization', `Bearer ${token}`)
      xhr.setRequestHeader('apikey', SUPABASE_ANON_KEY)
      // Content-Type is deliberately not set — the browser has to generate
      // the multipart boundary for a FormData body itself.

      if (onUploadProgress) {
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) onUploadProgress(e.loaded, e.total)
        }
      }
      // Every byte is out the door; anything from here on is the server
      // grading (n8n), which reports no progress of its own.
      if (onUploaded) xhr.upload.onload = () => onUploaded()

      const networkError = () =>
        resolve({ data: null, error: new Error('Failed to send a request to the Edge Function') })

      xhr.onerror = networkError
      xhr.onabort = networkError
      xhr.ontimeout = networkError

      xhr.onload = () => {
        const text = xhr.responseText
        let parsed = null
        try { parsed = JSON.parse(text) } catch { /* not JSON */ }

        if (xhr.status >= 200 && xhr.status < 300) {
          resolve({ data: parsed ?? {}, error: null })
          return
        }
        const error = new Error(`Edge Function returned a non-2xx status code`)
        // Callers read the real, student-friendly message back out of this,
        // the same way they do from supabase-js's FunctionsHttpError.
        error.context = new Response(text, { status: xhr.status })
        resolve({ data: null, error })
      }

      xhr.send(body)
    }).catch(() => {
      resolve({ data: null, error: new Error('Failed to send a request to the Edge Function') })
    })
  })
}
