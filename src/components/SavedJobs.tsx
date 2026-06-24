'use client';

import { useState, useEffect } from 'react';
import { getSavedJobs, updateJobStatus, removeJob } from '@/lib/storage';
import { Bookmark, ExternalLink, Mail, ChevronDown, Trash2 } from 'lucide-react';

const STATUS_COLORS: Record<string, string> = {
  interested: 'bg-blue-100 text-blue-700',
  applied: 'bg-yellow-100 text-yellow-700',
  messaged: 'bg-green-100 text-green-700',
  interviewing: 'bg-purple-100 text-purple-700',
  rejected: 'bg-red-100 text-red-700',
  accepted: 'bg-emerald-100 text-emerald-700',
};

const STATUSES = ['interested', 'applied', 'messaged', 'interviewing', 'rejected', 'accepted'];

export default function SavedJobs() {
  const [jobs, setJobs] = useState<ReturnType<typeof getSavedJobs>>([]);

  useEffect(() => {
    setJobs(getSavedJobs());
  }, []);

  function handleStatusChange(id: string, status: string) {
    updateJobStatus(id, status);
    setJobs(getSavedJobs());
  }

  function handleRemove(id: string) {
    removeJob(id);
    setJobs(getSavedJobs());
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
