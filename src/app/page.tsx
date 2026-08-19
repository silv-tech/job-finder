'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { Job } from '@/lib/types';
import { useAuth } from '@/lib/auth-context';
import LoginPage from '@/app/login/page';
import JobCard from '@/components/JobCard';
import MessageModal from '@/components/MessageModal';
import AlertsPanel from '@/components/AlertsPanel';
import SavedJobs from '@/components/SavedJobs';
import ProfileSettings from '@/components/ProfileSettings';
import { Search, Loader2, SlidersHorizontal, Bookmark, User, X, Check, LogOut } from 'lucide-react';

type Tab = 'search' | 'saved' | 'alerts' | 'profile';

const QUICK_SEARCHES = [
  'AI automation specialist remote',
  'AI implementation consultant',
  'prompt engineer',
  'no-code low-code developer',
  'AI chatbot developer',
  'technical product manager startup',
  'freelance web app developer',
  'AI solutions architect',
  'startup CTO co-founder',
  'automation specialist zapier make',
];

export default function Home() {
  const { user, loading: authLoading, signOut } = useAuth();
  const [tab, setTab] = useState<Tab>('search');
  const [query, setQuery] = useState('');
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(false);
  const [remoteOnly, setRemoteOnly] = useState(true);
  const [messageJob, setMessageJob] = useState<Job | null>(null);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [searched, setSearched] = useState(false);
  const [savedRefresh, setSavedRefresh] = useState(0);
  const [error, setError] = useState('');
  const [selectedFilters, setSelectedFilters] = useState<Set<string>>(new Set());
  const [dateFilter, setDateFilter] = useState('week');
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    fetch('/api/saved-jobs')
      .then((r) => r.json())
      .then((data) => {
        const saved = data.jobs || [];
        setSavedIds(new Set(saved.map((j: Job) => j.source_id || j.id)));
      })
      .catch(() => {});
  }, [savedRefresh]);

  function toggleFilter(filter: string) {
    setSelectedFilters((prev) => {
      const next = new Set(prev);
      if (next.has(filter)) {
        next.delete(filter);
      } else {
        next.add(filter);
      }
      return next;
    });
  }

  function clearFilters() {
    setSelectedFilters(new Set());
  }

  const searchJobs = useCallback(async (searchQuery?: string) => {
    const q = searchQuery || query;
    if (!q.trim()) return;

    setLoading(true);
    setSearched(true);
    setError('');
    try {
      const params = new URLSearchParams({
        q,
        remote: String(remoteOnly),
        date: dateFilter,
      });
      const res = await fetch(`/api/jobs?${params}`);
      if (!res.ok) throw new Error('Search failed');
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      return data.jobs || [];
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed. Please try again.');
      return [];
    }
  }, [query, remoteOnly, dateFilter]);

  async function handleSearch() {
    // If filters are selected, search all of them and combine
    if (selectedFilters.size > 0) {
      setLoading(true);
      setSearched(true);
      setError('');

      try {
        const searches = Array.from(selectedFilters).map((filter) => {
          const params = new URLSearchParams({ q: filter, remote: String(remoteOnly), date: dateFilter });
          return fetch(`/api/jobs?${params}`).then((r) => r.json());
        });

        // Also search the text input if it has content
        if (query.trim()) {
          const params = new URLSearchParams({ q: query, remote: String(remoteOnly), date: dateFilter });
          searches.push(fetch(`/api/jobs?${params}`).then((r) => r.json()));
        }

        const results = await Promise.all(searches);
        const allJobs: Job[] = results.flatMap((r) => r.jobs || []);

        // Deduplicate by title + company
        const seen = new Set<string>();
        const unique = allJobs.filter((job) => {
          const key = `${job.title.toLowerCase()}_${job.company.toLowerCase()}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });

        setJobs(unique);
      } catch (err) {
        setJobs([]);
        setError(err instanceof Error ? err.message : 'Search failed. Please try again.');
      } finally {
        setLoading(false);
      }
    } else {
      // Single search from text input
      const results = await searchJobs();
      setJobs(results || []);
      setLoading(false);
    }
  }

  async function handleQuickSearch(q: string) {
    // If no filters selected yet, just do a single quick search
    if (selectedFilters.size === 0 && !query.trim()) {
      setQuery(q);
      setLoading(true);
      setSearched(true);
      setError('');
      const results = await searchJobs(q);
      setJobs(results || []);
      setLoading(false);
    } else {
      toggleFilter(q);
    }
  }

  async function handleSaveJob(job: Job) {
    setSavedIds((prev) => new Set([...prev, job.id]));
    try {
      await fetch('/api/saved-jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_id: job.source_id || job.id,
          source: job.source,
          title: job.title,
          company: job.company,
          company_logo: job.company_logo,
          location: job.location,
          salary_min: job.salary_min,
          salary_max: job.salary_max,
          description: job.description,
          skills: job.skills,
          job_type: job.job_type,
          remote: job.remote,
          apply_url: job.apply_url,
          contact_email: job.contact_email,
          posted_at: job.posted_at,
          status: 'interested',
        }),
      });
      setSavedRefresh((r) => r + 1);
    } catch {
      // Supabase not configured — job still appears saved in UI
    }
  }

  // Auth gate
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 size={32} className="animate-spin text-indigo-500" />
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-lg font-bold text-slate-900 flex items-center gap-2.5">
              <img src="/logo.png" alt="Job Finder" className="w-8 h-8 rounded-xl shadow-sm" />
              Job Finder
            </h1>
            <div className="flex gap-1 bg-slate-100 rounded-xl p-1">
              {([
                { id: 'search' as Tab, label: 'Search', icon: Search },
                { id: 'saved' as Tab, label: 'Saved', icon: Bookmark },
                { id: 'alerts' as Tab, label: 'Alerts', icon: SlidersHorizontal },
                { id: 'profile' as Tab, label: 'Profile', icon: User },
              ]).map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => setTab(id)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg transition-all ${
                    tab === id
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  <Icon size={15} /> {label}
                </button>
              ))}
              <button
                onClick={signOut}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-sm font-medium rounded-lg text-slate-400 hover:text-red-500 transition-all ml-1"
                title="Sign out"
              >
                <LogOut size={15} />
              </button>
            </div>
          </div>

          {tab === 'search' && (
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <Search
                  size={16}
                  className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
                />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      if (debounceRef.current) clearTimeout(debounceRef.current);
                      debounceRef.current = setTimeout(() => handleSearch(), 500);
                    }
                  }}
                  placeholder="Search jobs or select filters below..."
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-800 placeholder-slate-400 focus:ring-2 focus:ring-slate-200 focus:border-slate-300 outline-none"
                />
              </div>
              <div className="flex items-center gap-0.5 bg-slate-100 rounded-xl p-1">
                {([
                  { value: 'today', label: 'Today' },
                  { value: '3days', label: '3 Days' },
                  { value: 'week', label: 'Week' },
                  { value: 'month', label: 'Month' },
                ]).map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setDateFilter(opt.value)}
                    className={`px-2.5 py-1.5 text-xs font-medium rounded-lg transition-all whitespace-nowrap ${
                      dateFilter === opt.value
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <label className="inline-flex items-center gap-2 px-3 py-2 bg-slate-100 rounded-xl cursor-pointer hover:bg-slate-200 transition-colors">
                <input
                  type="checkbox"
                  checked={remoteOnly}
                  onChange={(e) => setRemoteOnly(e.target.checked)}
                  className="rounded text-slate-900 border-slate-300"
                />
                <span className="text-sm text-slate-700 whitespace-nowrap">Remote</span>
              </label>
              <button
                onClick={handleSearch}
                disabled={loading || (!query.trim() && selectedFilters.size === 0)}
                className="inline-flex items-center gap-2 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-200 disabled:text-slate-400 text-white px-5 py-2.5 rounded-xl text-sm font-semibold transition-colors"
              >
                {loading ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
                Search{selectedFilters.size > 0 ? ` (${selectedFilters.size})` : ''}
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Content */}
      <main className="max-w-6xl mx-auto px-4 py-6">
        {tab === 'search' && (
          <>
            {/* Filter chips — always visible */}
            <div className="mb-6">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                  Select job types (pick multiple)
                </h2>
                {selectedFilters.size > 0 && (
                  <button
                    onClick={clearFilters}
                    className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-red-500 transition-colors"
                  >
                    <X size={12} /> Clear all
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {QUICK_SEARCHES.map((q) => {
                  const isSelected = selectedFilters.has(q);
                  return (
                    <button
                      key={q}
                      onClick={() => handleQuickSearch(q)}
                      className={`text-sm px-4 py-2 rounded-xl font-medium transition-all inline-flex items-center gap-1.5 ${
                        isSelected
                          ? 'bg-slate-900 text-white shadow-sm border border-slate-900'
                          : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-slate-300'
                      }`}
                    >
                      {isSelected && <Check size={14} />}
                      {q}
                    </button>
                  );
                })}
              </div>
              {selectedFilters.size > 0 && (
                <p className="text-xs text-slate-400 mt-2">
                  {selectedFilters.size} filter{selectedFilters.size > 1 ? 's' : ''} selected, click Search to find jobs matching all of them
                </p>
              )}
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-2xl p-4 mb-4 text-sm text-red-700">
                {error}
              </div>
            )}

            {loading ? (
              <div className="flex flex-col items-center justify-center py-20">
                <div className="bg-white rounded-2xl p-8 border border-slate-200 text-center">
                  <Loader2 size={36} className="animate-spin mb-3 text-slate-400 mx-auto" />
                  <p className="text-gray-500 font-medium">
                    Searching {selectedFilters.size > 1 ? `${selectedFilters.size} job types` : 'across job boards'}...
                  </p>
                </div>
              </div>
            ) : jobs.length > 0 ? (
              <div>
                <div className="flex items-center gap-3 mb-4">
                  <span className="text-sm font-semibold text-slate-700 bg-white px-3 py-1 rounded-full border border-slate-200">
                    {jobs.length} jobs found
                  </span>
                  {jobs.filter((j) => j.contact_email).length > 0 && (
                    <span className="text-sm font-semibold text-emerald-700 bg-emerald-50 px-3 py-1 rounded-full">
                      {jobs.filter((j) => j.contact_email).length} with direct contact
                    </span>
                  )}
                </div>
                <div className="grid gap-4">
                  {jobs.map((job) => (
                    <JobCard
                      key={job.id}
                      job={job}
                      onSave={handleSaveJob}
                      onMessage={setMessageJob}
                      isSaved={savedIds.has(job.id)}
                    />
                  ))}
                </div>
              </div>
            ) : searched ? (
              <div className="bg-white rounded-2xl p-12 border border-slate-200 text-center">
                <Search size={36} className="mx-auto mb-3 text-slate-300" />
                <p className="text-slate-500 font-medium">No jobs found. Try different keywords or disable remote-only filter.</p>
              </div>
            ) : (
              <div className="text-center py-12">
                <div className="bg-white rounded-2xl p-12 border border-slate-200 inline-block">
                  <img src="/logo.png" alt="Job Finder" className="w-16 h-16 rounded-2xl mx-auto mb-5" />
                  <h2 className="text-2xl font-bold text-slate-800 mb-2">Find your next gig</h2>
                  <p className="text-slate-500 max-w-md">
                    Select multiple job types above, or type your own search. Results from all filters are combined.
                  </p>
                </div>
              </div>
            )}
          </>
        )}

        {tab === 'saved' && <SavedJobs />}

        {tab === 'alerts' && <AlertsPanel />}

        {tab === 'profile' && <ProfileSettings />}
      </main>

      {messageJob && (
        <MessageModal job={messageJob} onClose={() => setMessageJob(null)} />
      )}
    </div>
  );
}
