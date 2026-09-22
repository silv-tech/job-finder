-- Run this in your Supabase SQL Editor to set up the database

-- Saved jobs table
CREATE TABLE saved_jobs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  source_id TEXT NOT NULL,
  source TEXT NOT NULL,
  title TEXT NOT NULL,
  company TEXT NOT NULL,
  company_logo TEXT,
  location TEXT,
  salary_min NUMERIC,
  salary_max NUMERIC,
  description TEXT,
  skills TEXT[] DEFAULT '{}',
  job_type TEXT,
  remote BOOLEAN DEFAULT false,
  apply_url TEXT,
  contact_email TEXT,
  posted_at TIMESTAMPTZ,
  status TEXT DEFAULT 'interested' CHECK (status IN ('new', 'interested', 'applied', 'messaged', 'interviewing', 'rejected', 'accepted')),
  notes TEXT,
  messaged_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, source_id)
);

-- Alerts table
CREATE TABLE alerts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  keywords TEXT[] NOT NULL,
  email TEXT NOT NULL,
  active BOOLEAN DEFAULT true,
  last_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Message log (track sent messages)
CREATE TABLE message_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  job_id UUID REFERENCES saved_jobs(id),
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  sent_at TIMESTAMPTZ DEFAULT now()
);

-- User profiles (synced with extension)
CREATE TABLE IF NOT EXISTS profiles (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID UNIQUE NOT NULL,
  name TEXT DEFAULT '',
  email TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  portfolio_url TEXT DEFAULT '',
  linkedin_url TEXT DEFAULT '',
  upwork_url TEXT DEFAULT '',
  resume_url TEXT DEFAULT '',
  headline TEXT DEFAULT '',
  skills TEXT[] DEFAULT '{}',
  bio TEXT DEFAULT '',
  resume_text TEXT DEFAULT '',       -- full imported resume/portfolio text
  writing_samples TEXT DEFAULT '',   -- user's real messages, for voice grounding
  role_highlights JSONB DEFAULT '{}'::jsonb, -- per-role proof points from resume + portfolio
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX idx_saved_jobs_status ON saved_jobs(status);
CREATE INDEX idx_saved_jobs_user ON saved_jobs(user_id);
CREATE INDEX idx_alerts_active ON alerts(active);
CREATE INDEX idx_alerts_user ON alerts(user_id);

-- Row Level Security. The API routes use the service-role key (which bypasses
-- RLS) and enforce user scoping in code, so enabling RLS here is defense in
-- depth: it blocks any direct anon/authenticated client access that isn't the
-- owner. Nothing in the app talks to these tables with the anon key.
ALTER TABLE saved_jobs  ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts      ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles    ENABLE ROW LEVEL SECURITY;

CREATE POLICY saved_jobs_owner  ON saved_jobs  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY alerts_owner      ON alerts      FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY message_log_owner ON message_log FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY profiles_owner    ON profiles    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- MIGRATION for an existing/live database (run this instead of the CREATEs
-- above if the tables already exist). Existing rows get a NULL user_id and
-- will no longer be visible to any user until you assign them an owner.
-- ============================================================================
--   ALTER TABLE saved_jobs  ADD COLUMN IF NOT EXISTS user_id UUID;
--   ALTER TABLE alerts      ADD COLUMN IF NOT EXISTS user_id UUID;
--   ALTER TABLE message_log ADD COLUMN IF NOT EXISTS user_id UUID;
--   ALTER TABLE saved_jobs  DROP CONSTRAINT IF EXISTS saved_jobs_source_id_key;
--   ALTER TABLE saved_jobs  ADD CONSTRAINT saved_jobs_user_source_key UNIQUE (user_id, source_id);
--   ALTER TABLE profiles    ADD COLUMN IF NOT EXISTS resume_text TEXT DEFAULT '';
--   ALTER TABLE profiles    ADD COLUMN IF NOT EXISTS writing_samples TEXT DEFAULT '';
--   ALTER TABLE profiles    ADD COLUMN IF NOT EXISTS role_highlights JSONB DEFAULT '{}'::jsonb;
--   -- then enable RLS + policies exactly as above.

-- Applications actually sent by the extension. logApplication used to only
-- bump a counter, so the message that went out was lost the moment it sent.
-- The end-of-day report reads from here.
CREATE TABLE applications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  title TEXT NOT NULL,
  company TEXT DEFAULT '',
  apply_url TEXT DEFAULT '',
  lane TEXT DEFAULT '',
  role TEXT DEFAULT '',
  score INT,
  apply_points INT,
  subject TEXT DEFAULT '',
  message TEXT DEFAULT '',
  posted_at TEXT DEFAULT '',
  -- 'sent', or 'needs_manual' for a job that wants a Loom video, a trial task
  -- or an external form and so could not be applied to automatically
  status TEXT DEFAULT 'sent',
  sent_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX applications_user_sent_idx ON applications (user_id, sent_at DESC);

-- Existing installs:
--   (run the CREATE TABLE and CREATE INDEX above once)
