'use client';

import { Job } from '@/lib/types';
import { Bookmark, ExternalLink, Mail, MapPin, Clock, Code } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface JobCardProps {
  job: Job;
  onSave: (job: Job) => void;
  onMessage: (job: Job) => void;
  isSaved?: boolean;
}

export default function JobCard({ job, onSave, onMessage, isSaved }: JobCardProps) {
  return (
    <div className="bg-white rounded-xl p-5 shadow-sm hover:shadow-md transition-all border border-gray-100">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          {job.company_logo ? (
            <img
              src={job.company_logo}
              alt={job.company}
              className="w-12 h-12 rounded-xl object-contain bg-gray-50 flex-shrink-0 border border-gray-100"
            />
          ) : (
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold text-lg flex-shrink-0 shadow-sm">
              {job.company.charAt(0)}
            </div>
          )}
          <div className="min-w-0">
            <h3 className="font-semibold text-gray-900 text-lg leading-tight truncate">
              {job.title}
            </h3>
            <p className="text-indigo-600 text-sm font-medium mt-0.5">{job.company}</p>
          </div>
        </div>
        <div className="flex gap-1.5 flex-shrink-0">
          <button
            onClick={() => onSave(job)}
            className={`p-2 rounded-lg transition-all ${
              isSaved
                ? 'bg-indigo-100 text-indigo-600 shadow-sm'
                : 'hover:bg-gray-100 text-gray-400 hover:text-gray-600'
            }`}
            title={isSaved ? 'Saved' : 'Save job'}
          >
            <Bookmark size={18} fill={isSaved ? 'currentColor' : 'none'} />
          </button>
          {job.contact_email && (
            <button
              onClick={() => onMessage(job)}
              className="p-2 rounded-lg hover:bg-emerald-100 text-gray-400 hover:text-emerald-600 transition-all"
              title="Send message"
            >
              <Mail size={18} />
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mt-3">
        <span className="inline-flex items-center gap-1 text-xs text-gray-600 bg-gray-100 px-2.5 py-1 rounded-full font-medium">
          <MapPin size={12} /> {job.location}
        </span>
        {job.remote && (
          <span className="text-xs text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full font-medium">
            Remote
          </span>
        )}
        <span className="inline-flex items-center gap-1 text-xs text-gray-500 bg-gray-50 px-2.5 py-1 rounded-full">
          <Clock size={12} /> {formatDistanceToNow(new Date(job.posted_at), { addSuffix: true })}
        </span>
        {job.salary_max && (
          <span className="text-xs text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full font-semibold">
            ${job.salary_min?.toLocaleString() || '?'} - ${job.salary_max.toLocaleString()}
          </span>
        )}
        <span className="text-xs text-indigo-600 bg-indigo-50 px-2.5 py-1 rounded-full font-medium capitalize">
          {job.source}
        </span>
      </div>

      {job.skills.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-3">
          {[...new Set(job.skills)].slice(0, 8).map((skill, i) => (
            <span
              key={`${skill}_${i}`}
              className="inline-flex items-center gap-1 text-xs text-purple-700 bg-purple-50 px-2 py-0.5 rounded font-medium"
            >
              <Code size={10} /> {skill}
            </span>
          ))}
          {[...new Set(job.skills)].length > 8 && (
            <span className="text-xs text-gray-400 font-medium">+{[...new Set(job.skills)].length - 8} more</span>
          )}
        </div>
      )}

      <p className="text-sm text-gray-600 mt-3 line-clamp-2 leading-relaxed">
        {job.short_description || job.description.slice(0, 200)}
      </p>

      <div className="flex items-center gap-3 mt-4 pt-3 border-t border-gray-100">
        <button
          onClick={() => onMessage(job)}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-white bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 px-5 py-2 rounded-lg transition-all shadow-sm"
        >
          Apply <ExternalLink size={14} />
        </button>
        {job.contact_email && (
          <span className="inline-flex items-center gap-1 text-xs text-emerald-600 font-medium">
            <Mail size={12} /> Direct email available
          </span>
        )}
      </div>
    </div>
  );
}
