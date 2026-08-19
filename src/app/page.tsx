'use client';

import { useState, useCallback, useEffect } from 'react';
import { Job } from '@/lib/types';
import { Job as SavedJobType } from '@/lib/types';
import { useAuth } from '@/lib/auth-context';
import LoginPage from '@/app/login/page';
import JobCard from '@/components/JobCard';
import MessageModal from '@/components/MessageModal';
import AlertsPanel from '@/components/AlertsPanel';
import SavedJobs from '@/components/SavedJobs';
import ProfileSettings from '@/components/ProfileSettings';
import { Search, Loader2, SlidersHorizontal, Bookmark, Briefcase, Sparkles, User, X, Check, Clock, LogOut } from 'lucide-react';

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

  useEffect(() => {
    fetch('/api/saved-jobs')
      .then((r) => r.json())
      .then((data) => {
        const saved = data.jobs || [];
        setSavedIds(new Set(saved.map((j: SavedJobType) => j.source_id || j.id)));
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
      <header className="bg-gradient-to-r from-indigo-600 via-purple-600 to-blue-600 sticky top-0 z-40 shadow-lg">
        <div className="max-w-6xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-xl font-bold text-white flex items-center gap-2">
              <div className="bg-white/20 backdrop-blur-sm p-1.5 rounded-lg">
                <Briefcase size={20} className="text-white" />
              </div>
              Job Finder
              <Sparkles size={14} className="text-yellow-300" />
            </h1>
            <div className="flex gap-1 bg-white/15 backdrop-blur-sm rounded-lg p-1">
              {([
                { id: 'search' as Tab, label: 'Search', icon: Search },
                { id: 'saved' as Tab, label: 'Saved', icon: Bookmark },
                { id: 'alerts' as Tab, label: 'Alerts', icon: SlidersHorizontal },
                { id: 'profile' as Tab, label: 'Profile', icon: User },
              ]).map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => setTab(id)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-all ${
                    tab === id
                      ? 'bg-white text-indigo-700 shadow-sm'
                      : 'text-white/80 hover:text-white hover:bg-white/10'
                  }`}
                >
                  <Icon size={16} /> {label}
                </button>
              ))}
              <button
                onClick={signOut}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md text-white/60 hover:text-white hover:bg-white/10 transition-all ml-1"
                title="Sign out"
              >
                <LogOut size={16} />
              </button>
            </div>
          </div>

          {tab === 'search' && (
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <Search
                  size={18}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-indigo-400"
                />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                  placeholder="Search jobs or select filters below..."
                  className="w-full pl-10 pr-4 py-2.5 bg-white/95 backdrop-blur-sm border-0 rounded-lg text-sm text-gray-800 placeholder-gray-400 focus:ring-2 focus:ring-white/50 outline-none shadow-sm"
                />
              </div>
              <div className="flex items-center gap-1 bg-white/15 backdrop-blur-sm rounded-lg p-1">
                {([
                  { value: 'today', label: 'Today' },
                  { value: '3days', label: '3 Days' },
                  { value: 'week', label: 'Week' },
                  { value: 'month', label: 'Month' },
                ]).map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setDateFilter(opt.value)}
                    className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-all whitespace-nowrap ${
                      dateFilter === opt.value
                        ? 'bg-white text-indigo-700 shadow-sm'
                        : 'text-white/70 hover:text-white hover:bg-white/10'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <label className="inline-flex items-center gap-2 px-3 py-2 bg-white/15 backdrop-blur-sm rounded-lg cursor-pointer hover:bg-white/25 transition-colors">
                <input
                  type="checkbox"
                  checked={remoteOnly}
                  onChange={(e) => setRemoteOnly(e.target.checked)}
                  className="rounded text-indigo-600"
                />
                <span className="text-sm text-white whitespace-nowrap">Remote</span>
              </label>
              <button
                onClick={handleSearch}
                disabled={loading || (!query.trim() && selectedFilters.size === 0)}
                className="inline-flex items-center gap-2 bg-white hover:bg-gray-50 disabled:bg-white/50 disabled:text-gray-400 text-indigo-700 px-5 py-2.5 rounded-lg text-sm font-semibold transition-colors shadow-sm"
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
                <h2 className="text-sm font-semibold text-indigo-400 uppercase tracking-wider">
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
                      className={`text-sm px-4 py-2 rounded-full font-medium transition-all inline-flex items-center gap-1.5 ${
                        isSelected
                          ? 'bg-indigo-600 text-white shadow-md border border-indigo-600'
                          : 'bg-white border border-indigo-100 text-indigo-600 hover:bg-indigo-50 hover:border-indigo-300 hover:shadow-sm'
                      }`}
                    >
                      {isSelected && <Check size={14} />}
                      {q}
                    </button>
                  );
                })}
              </div>
              {selectedFilters.size > 0 && (
                <p className="text-xs text-gray-400 mt-2">
                  {selectedFilters.size} filter{selectedFilters.size > 1 ? 's' : ''} selected — click Search to find jobs matching all of them
                </p>
              )}
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4 text-sm text-red-700">
                {error}
              </div>
            )}

            {loading ? (
              <div className="flex flex-col items-center justify-center py-20">
                <div className="bg-white rounded-2xl p-8 shadow-sm text-center">
                  <Loader2 size={36} className="animate-spin mb-3 text-indigo-500 mx-auto" />
                  <p className="text-gray-500 font-medium">
                    Searching {selectedFilters.size > 1 ? `${selectedFilters.size} job types` : 'across job boards'}...
                  </p>
                </div>
              </div>
            ) : jobs.length > 0 ? (
              <div>
                <div className="flex items-center gap-3 mb-4">
                  <span className="text-sm font-semibold text-gray-700 bg-white px-3 py-1 rounded-full shadow-sm">
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
              <div className="bg-white rounded-2xl p-12 shadow-sm text-center">
                <Search size={36} className="mx-auto mb-3 text-gray-300" />
                <p className="text-gray-500 font-medium">No jobs found. Try different keywords or disable remote-only filter.</p>
              </div>
            ) : (
              <div className="text-center py-12">
                <div className="bg-white rounded-2xl p-12 shadow-sm inline-block">
                  <div className="bg-gradient-to-br from-indigo-500 to-purple-600 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-5">
                    <Briefcase size={28} className="text-white" />
                  </div>
                  <h2 className="text-2xl font-bold text-gray-800 mb-2">Find your next gig</h2>
                  <p className="text-gray-500 max-w-md">
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
