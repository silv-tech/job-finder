'use client';

import { useState, useEffect } from 'react';
import { SavedJob } from '@/lib/types';
import { authedFetch, apiError } from '@/lib/api-client';
import { Bookmark, ExternalLink, Mail, ChevronDown, Trash2, Loader2 } from 'lucide-react';

const STATUS_COLORS: Record<string, string> = {
  new: 'bg-gray-100 text-gray-700',
  interested: 'bg-blue-100 text-blue-700',
  applied: 'bg-yellow-100 text-yellow-700',
  messaged: 'bg-green-100 text-green-700',
  interviewing: 'bg-purple-100 text-purple-700',
  rejected: 'bg-red-100 text-red-700',
  accepted: 'bg-emerald-100 text-emerald-700',
};

const STATUSES = ['new', 'interested', 'applied', 'messaged', 'interviewing', 'rejected', 'accepted'];

export default function SavedJobs() {
  const [jobs, setJobs] = useState<SavedJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');

  useEffect(() => {
    fetchJobs();
  }, []);

  async function fetchJobs() {
    try {
      const res = await authedFetch('/api/saved-jobs');
      if (!res.ok) {
        setLoadError(await apiError(res, 'Could not load your saved jobs.'));
        return;
      }
      const data = await res.json();
      setJobs(data.jobs || []);
      setLoadError('');
    } catch {
      setLoadError('Could not reach the server. Check your connection.');
    } finally {
      setLoading(false);
    }
  }

  async function handleStatusChange(id: string, status: string) {
    const previous = jobs.find((j) => j.id === id)?.status;
    // Optimistic update, rolled back if the server says no
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, status: status as SavedJob['status'] } : j)));
    setActionError('');
    const rollback = () =>
      setJobs((prev) => prev.map((j) => (j.id === id && previous ? { ...j, status: previous } : j)));
    try {
      const res = await authedFetch('/api/saved-jobs', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status }),
      });
      if (!res.ok) {
        rollback();
        setActionError(await apiError(res, 'Could not update the status.'));
      }
    } catch {
      rollback();
      setActionError('Could not reach the server. The status was not changed.');
    }
  }

  async function handleRemove(id: string) {
    const index = jobs.findIndex((j) => j.id === id);
    const removed = jobs[index];
    if (!removed) return;
    setJobs((prev) => prev.filter((j) => j.id !== id));
    setActionError('');
    const restore = () =>
      setJobs((prev) => (prev.some((j) => j.id === id) ? prev : [...prev.slice(0, index), removed, ...prev.slice(index)]));
    try {
      const res = await authedFetch('/api/saved-jobs', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        restore();
        setActionError(await apiError(res, 'Could not remove the job.'));
      }
    } catch {
      restore();
      setActionError('Could not reach the server. The job was not removed.');
    }
  }

  if (loading) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl p-8 text-center">
        <Loader2 size={32} className="mx-auto text-gray-300 mb-3 animate-spin" />
        <p className="text-gray-500">Loading saved jobs...</p>
      </div>
    );
  }

  if (loadError && jobs.length === 0) {
    return (
      <div className="bg-white border border-red-200 rounded-xl p-8 text-center">
        <p className="text-red-600 mb-3">{loadError}</p>
        <button
          onClick={() => {
            setLoading(true);
            fetchJobs();
          }}
          className="text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 px-4 py-2 rounded-lg"
        >
          Try again
        </button>
      </div>
    );
  }

  if (jobs.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl p-8 text-center">
        <Bookmark size={32} className="mx-auto text-gray-300 mb-3" />
        <p className="text-gray-500">No saved jobs yet. Save jobs from the search to track them here.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {actionError && (
        <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{actionError}</p>
      )}
      {jobs.map((job) => (
        <div key={job.id} className="bg-white border border-gray-200 rounded-xl p-4 flex items-center justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h3 className="font-medium text-gray-900 truncate">{job.title}</h3>
            <p className="text-sm text-gray-500">{job.company} · {job.location}</p>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            <div className="relative">
              <select
                value={job.status}
                onChange={(e) => handleStatusChange(job.id, e.target.value)}
                className={`appearance-none text-xs font-medium px-3 py-1.5 pr-7 rounded-full cursor-pointer ${STATUS_COLORS[job.status] || 'bg-gray-100 text-gray-700'}`}
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>

            {job.contact_email && (
              <a
                href={`mailto:${job.contact_email}`}
                className="p-2 hover:bg-green-100 text-gray-400 hover:text-green-600 rounded-lg transition-colors"
              >
                <Mail size={16} />
              </a>
            )}
            <a
              href={job.apply_url}
              target="_blank"
              rel="noopener noreferrer"
              className="p-2 hover:bg-blue-100 text-gray-400 hover:text-blue-600 rounded-lg transition-colors"
            >
              <ExternalLink size={16} />
            </a>
            <button
              onClick={() => handleRemove(job.id)}
              className="p-2 hover:bg-red-100 text-gray-400 hover:text-red-600 rounded-lg transition-colors"
            >
              <Trash2 size={16} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
