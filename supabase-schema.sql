-- Run this in your Supabase SQL Editor to set up the database

-- Saved jobs table
CREATE TABLE saved_jobs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  source_id TEXT UNIQUE NOT NULL,
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
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Alerts table
CREATE TABLE alerts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  keywords TEXT[] NOT NULL,
  email TEXT NOT NULL,
  active BOOLEAN DEFAULT true,
  last_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Message log (track sent messages)
CREATE TABLE message_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
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
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX idx_saved_jobs_status ON saved_jobs(status);
CREATE INDEX idx_saved_jobs_source_id ON saved_jobs(source_id);
CREATE INDEX idx_alerts_active ON alerts(active);
