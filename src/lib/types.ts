export interface Job {
  id: string;
  title: string;
  company: string;
  company_logo?: string;
  location: string;
  salary_min?: number;
  salary_max?: number;
  salary_currency?: string;
  description: string;
  short_description?: string;
  skills: string[];
  job_type: string; // full-time, part-time, contract
  remote: boolean;
  apply_url: string;
  contact_email?: string;
  source: 'jsearch' | 'remotive' | 'upwork' | 'himalayas' | 'onlinejobs_ph' | 'extension';
  source_id: string;
  posted_at: string;
  created_at: string;
}

export interface SavedJob extends Job {
  status: 'new' | 'interested' | 'applied' | 'messaged' | 'interviewing' | 'rejected' | 'accepted';
  notes?: string;
  messaged_at?: string;
}

export interface MessageTemplate {
  id: string;
  name: string;
  subject: string;
  body: string;
  created_at: string;
}

export interface Alert {
  id: string;
  keywords: string[];
  email: string;
  active: boolean;
  last_sent_at?: string;
  created_at: string;
}

export interface JobFilters {
  query: string;
  remote_only: boolean;
  job_type: string;
  min_salary?: number;
  sort_by: 'date' | 'relevance';
  page: number;
}
