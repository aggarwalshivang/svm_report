// Small shared style bits for the Add Exams tabs (App/Sheet) so both
// match the rest of the dashboard's dark-theme-aware input styling
// (see index.css's `input, textarea, select` override) without each
// tab redefining the same constants.
export const GOLD = 'var(--gold)'
export const NAV = 'var(--nav)'
export const inputClass = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none bg-white'
export function focusGold(e) { e.target.style.boxShadow = `0 0 0 2px ${GOLD}40` }
export function blurGold(e) { e.target.style.boxShadow = '' }
