// Worksheets carry no marks or chapter/topic tag — only two free-text AI
// grading fields (handwriting_feedback, assignment_feedback). This module
// derives a Strong/Moderate/Weak-style performance signal for worksheets by
// text-mining assignment_feedback with a deterministic keyword scorer, no
// LLM calls and no schema/n8n changes. Pure functions only (no React/Supabase
// imports) so both dashboards can share one copy instead of a third
// duplicate of this logic.

// assignments.portion looks like "Chapter 4 | 10 Qs | Class 9" — the chapter
// label is everything before the first pipe. Older assignments predating the
// portion column (or ones the teacher left blank) fall back to the title.
export function extractChapterLabel(assignment) {
  const portion = (assignment?.portion || '').trim()
  if (portion) return portion.split('|')[0].trim() || assignment.title
  return assignment?.title || 'Untitled'
}

const POSITIVE_MARKERS = [
  'excellent', 'well done', 'good work', 'good job', 'correct', 'accurate',
  'neat', 'perfect', 'no mistakes', 'no errors', 'strong grasp',
  'good understanding', 'clear concept', 'all correct', 'great job',
  'good effort', 'well attempted', 'nicely done', 'flawless', 'impressive',
]

const NEGATIVE_MARKERS = [
  'incorrect', 'wrong', 'error', 'mistake', 'needs improvement',
  'need improvement', 'missed', 'did not', "didn't", 'confus', 'unable to',
  'struggl', 'weak', 'lacking', 'careless', 'not clear', 'misunderstood',
  'incomplete', 'unattempted', 'not attempted', 'poor', 'redo', 'revise',
  'improve',
]

// Small taxonomy so recurring-mistake reporting reads as actionable
// categories ("Conceptual gaps", "Incomplete work"...) instead of a raw word
// cloud — each category is a set of trigger phrases checked against a
// sentence already flagged negative by NEGATIVE_MARKERS.
export const MISTAKE_CATEGORIES = [
  {
    key: 'calculation',
    label: 'Calculation / silly mistakes',
    patterns: ['silly mistake', 'calculation error', 'careless', 'arithmetic', 'sign error', 'copying error'],
  },
  {
    key: 'conceptual',
    label: 'Conceptual gaps',
    patterns: ['concept', 'misunderstood', 'confus', "doesn't understand", 'not clear', 'unclear', 'fundamental'],
  },
  {
    key: 'incomplete',
    label: 'Incomplete work',
    patterns: ['incomplete', 'unattempted', 'not attempted', 'missed', 'skip', 'left blank', 'partially'],
  },
  {
    key: 'presentation',
    label: 'Presentation / steps not shown',
    patterns: ['steps missing', 'show your work', 'no working', 'method not shown', 'working not shown', 'presentation', 'handwriting'],
  },
  {
    key: 'wrong_answer',
    label: 'Wrong final answers',
    patterns: ['incorrect', 'wrong answer', 'wrong', 'error'],
  },
]

function splitSentences(text) {
  return (text || '')
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function matchesAny(sentenceLower, phrases) {
  return phrases.some((p) => sentenceLower.includes(p))
}

// Classifies every sentence in a feedback blob as positive/negative by
// keyword presence. A sentence can't be both — negative markers take
// priority since "needs improvement" style phrasing is more diagnostic than
// a generic "good effort" aside in the same paragraph.
export function scoreFeedbackText(text) {
  const sentences = splitSentences(text)
  let positiveCount = 0
  let negativeCount = 0
  const negativeSentences = []
  sentences.forEach((s) => {
    const lower = s.toLowerCase()
    if (matchesAny(lower, NEGATIVE_MARKERS)) {
      negativeCount++
      negativeSentences.push(s)
    } else if (matchesAny(lower, POSITIVE_MARKERS)) {
      positiveCount++
    }
  })
  return { positiveCount, negativeCount, negativeSentences }
}

// null means "no positive/negative signal found in this text" — excluded
// from averages rather than guessed at, so vague prose doesn't silently drag
// down (or inflate) a chapter's score.
export function feedbackToPerformancePct(text) {
  const { positiveCount, negativeCount } = scoreFeedbackText(text)
  const total = positiveCount + negativeCount
  if (total === 0) return null
  return Math.round((positiveCount / total) * 100)
}

// Pairs one assignment with one matched worksheet_feedback row (as already
// computed by each dashboard's existing fuzzy-matching) into a single
// performance data point. Returns null when there's no assignment_feedback
// text to mine yet (ungraded / pending).
export function computeSubmissionPerformance(assignment, feedback, student) {
  const text = feedback?.assignment_feedback
  if (!text) return null
  const { negativeSentences } = scoreFeedbackText(text)
  const pct = feedbackToPerformancePct(text)
  if (pct === null) return null
  return {
    assignmentId: assignment.id,
    subject: assignment.subject,
    chapter: extractChapterLabel(assignment),
    studentId: student?.student_id ?? feedback?.student_id ?? null,
    studentName: student?.student_name ?? feedback?.student_name ?? null,
    pct,
    negativeSentences,
  }
}

// Same shape as the existing chapterStats/topicStats memos ({ topic,
// subject, avg, best, worst, count }) so the existing ChapterBarChart /
// ModalTopicTable / TopicTable components can render this data unmodified.
export function aggregateChapterStats(rows) {
  const map = {}
  rows.forEach((r) => {
    const key = `${r.subject}||${r.chapter}`
    if (!map[key]) map[key] = { subject: r.subject, topic: r.chapter, total: 0, count: 0, best: 0, worst: 100 }
    map[key].total += r.pct
    map[key].count += 1
    map[key].best = Math.max(map[key].best, r.pct)
    map[key].worst = Math.min(map[key].worst, r.pct)
  })
  return Object.values(map)
    .map((t) => ({ ...t, avg: +(t.total / t.count).toFixed(1), best: +t.best.toFixed(1), worst: +t.worst.toFixed(1) }))
    .sort((a, b) => b.avg - a.avg)
}

export function aggregateSubjectStats(rows) {
  const map = {}
  rows.forEach((r) => {
    if (!map[r.subject]) map[r.subject] = { subject: r.subject, total: 0, count: 0 }
    map[r.subject].total += r.pct
    map[r.subject].count += 1
  })
  return Object.values(map).map((s) => ({ ...s, avg: +(s.total / s.count).toFixed(1) }))
}

// Tallies MISTAKE_CATEGORIES hits across every negative sentence in scope —
// the "recurring error patterns" surfaced to teachers/students, ranked by
// how often each category comes up, each with one real example.
export function topRecurringIssues(rows, { limit = 5 } = {}) {
  const tally = {}
  rows.forEach((r) => {
    r.negativeSentences.forEach((sentence) => {
      const lower = sentence.toLowerCase()
      MISTAKE_CATEGORIES.forEach((cat) => {
        if (matchesAny(lower, cat.patterns)) {
          if (!tally[cat.key]) tally[cat.key] = { key: cat.key, label: cat.label, count: 0, example: sentence }
          tally[cat.key].count += 1
        }
      })
    })
  })
  return Object.values(tally).sort((a, b) => b.count - a.count).slice(0, limit)
}

// Strong (>=80) / Moderate (60-79) / Weak (<60) — same thresholds already
// used by the Tests chapter analysis on both dashboards, kept identical so
// the labels mean the same thing everywhere in the app.
export function classifyChapters(chapterStats) {
  return {
    strong: chapterStats.filter((t) => t.avg >= 80).sort((a, b) => b.avg - a.avg),
    moderate: chapterStats.filter((t) => t.avg >= 60 && t.avg < 80).sort((a, b) => b.avg - a.avg),
    weak: chapterStats.filter((t) => t.avg < 60).sort((a, b) => a.avg - b.avg),
  }
}

// Only Moderate/Weak chapters get a suggestion — Strong chapters don't need
// a revision plan. audience only changes phrasing/pronoun.
export function buildSuggestion(chapterStat, topIssuesForChapter, { audience = 'teacher' } = {}) {
  const issueLabel = topIssuesForChapter?.[0]?.label
  const issueClause = issueLabel ? ` Recurring issue: ${issueLabel.toLowerCase()}.` : ''
  if (audience === 'student') {
    if (chapterStat.avg < 60) {
      return `Revisit ${chapterStat.topic} (${chapterStat.subject}) — you're at ${chapterStat.avg}% on this chapter.${issueClause} Redo the flagged questions and go through the worked examples again.`
    }
    return `${chapterStat.topic} (${chapterStat.subject}) is at ${chapterStat.avg}% — close to strong.${issueClause} A bit more practice here should get you there.`
  }
  if (chapterStat.avg < 60) {
    return `Plan a revision session on ${chapterStat.topic} (${chapterStat.subject}) — class is at ${chapterStat.avg}% on this chapter.${issueClause}`
  }
  return `${chapterStat.topic} (${chapterStat.subject}) is moderate (${chapterStat.avg}%) — worth a quick recap.${issueClause}`
}
