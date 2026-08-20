// Some legacy student_scores.topic_name values have a trailing "(Test N)"
// baked into the stored string (e.g. "Chemical Reactions and Equations (Test 3)").
// Chapter-wise analysis (Strong/Moderate/Weak/By Chapter) should treat all
// tests of the same chapter as one row, so we group on this normalized name
// instead of the raw topic_name.
export function normalizeTopicName(topicName) {
  return (topicName || '').replace(/\s*\(\s*test\s*\d+\s*\)\s*$/i, '').trim()
}
