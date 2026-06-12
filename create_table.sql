-- Run this in Supabase SQL Editor to create the table
-- Dashboard → SQL Editor → New Query → paste → Run

CREATE TABLE IF NOT EXISTS student_scores (
    id           BIGSERIAL PRIMARY KEY,
    class        INTEGER NOT NULL,
    student_name TEXT NOT NULL,
    date         DATE NOT NULL,
    subject      TEXT NOT NULL,
    topic_name   TEXT,
    total_marks  INTEGER,
    score_obtained NUMERIC,
    is_absent    BOOLEAN DEFAULT FALSE,
    created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Index for common queries
CREATE INDEX IF NOT EXISTS idx_student_scores_class       ON student_scores(class);
CREATE INDEX IF NOT EXISTS idx_student_scores_student     ON student_scores(student_name);
CREATE INDEX IF NOT EXISTS idx_student_scores_date        ON student_scores(date);
CREATE INDEX IF NOT EXISTS idx_student_scores_subject     ON student_scores(subject);
