import { Job } from './types';

interface SavedJob extends Job {
  status: string;
  notes?: string;
  savedAt: string;
}

interface Alert {
  id: string;
  keywords: string[];
  email: string;
  active: boolean;
  created_at: string;
}

function getItem<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : fallback;
  } catch {
    return fallback;
  }
}

function setItem(key: string, value: unknown) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(key, JSON.stringify(value));
}

// --- Saved Jobs ---
export function getSavedJobs(): SavedJob[] {
  return getItem<SavedJob[]>('job_finder_saved', []);
}

export function saveJob(job: Job, status = 'interested'): SavedJob {
  const saved = getSavedJobs();
  const existing = saved.find((j) => j.id === job.id);
  if (existing) return existing;

  const savedJob: SavedJob = { ...job, status, savedAt: new Date().toISOString() };
  setItem('job_finder_saved', [savedJob, ...saved]);
  return savedJob;
}

export function updateJobStatus(jobId: string, status: string) {
  const saved = getSavedJobs();
  const updated = saved.map((j) => (j.id === jobId ? { ...j, status } : j));
  setItem('job_finder_saved', updated);
}

export function removeJob(jobId: string) {
  const saved = getSavedJobs().filter((j) => j.id !== jobId);
  setItem('job_finder_saved', saved);
}

export function isJobSaved(jobId: string): boolean {
  return getSavedJobs().some((j) => j.id === jobId);
}

// --- Alerts ---
export function getAlerts(): Alert[] {
  return getItem<Alert[]>('job_finder_alerts', []);
}

export function addAlert(keywords: string[], email: string): Alert {
  const alerts = getAlerts();
  const alert: Alert = {
    id: crypto.randomUUID(),
    keywords,
    email,
    active: true,
    created_at: new Date().toISOString(),
  };
  setItem('job_finder_alerts', [alert, ...alerts]);
  return alert;
}

export function removeAlert(id: string) {
  const alerts = getAlerts().filter((a) => a.id !== id);
  setItem('job_finder_alerts', alerts);
}
