'use client';

import { useEffect, useState } from 'react';
import { authedFetch, apiError } from '@/lib/api-client';
import { ROLE_KEYS, ROLE_LABELS, type RoleHighlights as Highlights, type RoleKey } from '@/lib/roles';
import { Briefcase, Loader2, RefreshCw, Save, Check } from 'lucide-react';

// Per-role proof points the AI leads with when writing an application for that
// kind of job. Filled automatically from the resume + portfolio; editable.
export default function RoleHighlights() {
  const [highlights, setHighlights] = useState<Highlights>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'regenerate' | 'save' | null>(null);
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    // May take ~20s the first time: the server generates them if missing.
    authedFetch('/api/extension/role-highlights')
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) setError(await apiError(res, 'Could not load role examples.'));
        else setHighlights((await res.json()).highlights || {});
      })
      .catch(() => !cancelled && setError('Could not reach the server.'))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  async function regenerate() {
    setBusy('regenerate');
    setError('');
    try {
      const res = await authedFetch('/api/extension/role-highlights', { method: 'POST' });
      if (!res.ok) setError(await apiError(res, 'Could not regenerate.'));
      else {
        setHighlights((await res.json()).highlights || {});
        setDirty(false);
      }
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    setBusy('save');
    setError('');
    try {
      const res = await authedFetch('/api/extension/role-highlights', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ highlights }),
      });
      if (!res.ok) setError(await apiError(res, 'Could not save.'));
      else {
        setHighlights((await res.json()).highlights || {});
        setDirty(false);
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(null);
    }
  }

  function edit(key: RoleKey, value: string) {
    setHighlights((h) => ({ ...h, [key]: value }));
    setDirty(true);
  }

  return (
    <div className="bg-white rounded-2xl p-6 border border-slate-200">
      <div className="flex items-start justify-between gap-4 mb-1">
        <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <Briefcase size={16} className="text-slate-500" /> Role Examples
        </label>
        <button
          onClick={regenerate}
          disabled={loading || busy !== null}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 px-3 py-1.5 rounded-lg"
        >
          {busy === 'regenerate' ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          Regenerate from resume &amp; portfolio
        </button>
      </div>
      <p className="text-xs text-slate-400 mb-4">
        When a job is a developer, management, automation, VA or admin role, the application leads with these. They&apos;re written
        automatically from your resume and portfolio and refresh when those change. If you edit them, your version is kept.
        {highlights._edited && ' (Edited by you)'}
      </p>

      {loading ? (
        <p className="flex items-center gap-2 text-sm text-slate-400">
          <Loader2 size={14} className="animate-spin" /> Reading your resume and portfolio (first time takes about 20 seconds)...
        </p>
      ) : (
        <div className="space-y-4">
          {ROLE_KEYS.map((key) => (
            <div key={key}>
              <div className="text-xs font-semibold text-slate-500 uppercase mb-1">{ROLE_LABELS[key]}</div>
              <textarea
                value={highlights[key] || ''}
                onChange={(e) => edit(key, e.target.value)}
                rows={5}
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-slate-200 focus:border-slate-300 outline-none resize-y leading-relaxed"
              />
            </div>
          ))}
          <button
            onClick={save}
            disabled={!dirty || busy !== null}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 text-white"
          >
            {saved ? <Check size={16} /> : busy === 'save' ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            {saved ? 'Saved!' : 'Save role examples'}
          </button>
        </div>
      )}

      {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg mt-3">{error}</p>}
    </div>
  );
}
