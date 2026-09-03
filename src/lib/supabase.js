import { createClient } from '@supabase/supabase-js'

export const SUPABASE_URL = 'https://cexbpkbadthoqbruyjdg.supabase.co'
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNleGJwa2JhZHRob3FicnV5amRnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgyMzA5MjMsImV4cCI6MjA5MzgwNjkyM30.lOU0y9NXbJX86t9CQRv5kgLyKGngezO7pUUhYr2eFnA'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
