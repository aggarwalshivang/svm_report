// Some legacy student_scores.topic_name values have a trailing "(Test N)"
// baked into the stored string (e.g. "Chemical Reactions and Equations (Test 3)"),
// inconsistent whitespace (leading space, double space), or a singular/plural
// variant of the same chapter (e.g. "Quadratic Equation" vs "Quadratic Equations").
// Chapter-wise analysis (Strong/Moderate/Weak/By Chapter) should treat all
// tests of the same chapter as one row, so we group on this normalized name
// instead of the raw topic_name.
const TOPIC_SYNONYMS = {
  'arithmetic progression': 'Arithmetic Progressions',
  'arithmetic progressions': 'Arithmetic Progressions',
  'quadratic equation': 'Quadratic Equations',
  'quadratic equations': 'Quadratic Equations',
}

export function normalizeTopicName(topicName) {
  const cleaned = (topicName || '')
    .replace(/\s*\(\s*test\s*\d+\s*\)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
  return TOPIC_SYNONYMS[cleaned.toLowerCase()] || cleaned
}

// Legacy rows sometimes stored the subject as "Math" instead of "Maths" —
// every exact-match filter/badge in the app (`subject === 'Maths'`) silently
// dropped those rows. Canonicalize at load time so they're included.
const SUBJECT_SYNONYMS = {
  math: 'Maths',
  maths: 'Maths',
  science: 'Science',
}

export function normalizeSubject(subject) {
  const trimmed = (subject || '').trim()
  return SUBJECT_SYNONYMS[trimmed.toLowerCase()] || trimmed
}
