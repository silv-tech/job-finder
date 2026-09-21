'use client';

import { Job } from '@/lib/types';
import { getProfile, generateMessage } from '@/lib/profile';
import { authedFetch, apiError } from '@/lib/api-client';
import { ROLE_KEYS, ROLE_LABELS } from '@/lib/roles';
import { X, Send, Copy, Check, ExternalLink, Mail, Sparkles, Loader2, RefreshCw, Wand2 } from 'lucide-react';
import { useState, useEffect, useEffectEvent, useRef } from 'react';

interface MessageModalProps {
  job: Job;
  onClose: () => void;
}

export default function MessageModal({ job, onClose }: MessageModalProps) {
  // Start with the template immediately; the AI draft follows. The parent
  // keys this component by job, so this runs once per job.
  const [template] = useState(() =>
    generateMessage(getProfile(), {
      title: job.title,
      company: job.company,
      description: job.description,
      skills: job.skills,
    })
  );
  const [subject, setSubject] = useState(template.subject);
  const [body, setBody] = useState(template.body);
  const [copied, setCopied] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [aiLoading, setAiLoading] = useState(true);
  const [isAiGenerated, setIsAiGenerated] = useState(false);
  // AI draft that arrived after the user started editing; offered, not forced.
  const [pendingAi, setPendingAi] = useState<{ subject: string; body: string } | null>(null);
  const editedRef = useRef(false);
  // Role focus the AI wrote for ('general' = none). Detected on the first draft.
  const [role, setRole] = useState<string>('');
  // false when the server couldn't fact-check the AI draft
  const [factChecked, setFactChecked] = useState(true);

  const generateFirstDraft = useEffectEvent(() => {
    generateWithAI(false);
  });
  useEffect(() => {
    generateFirstDraft();
  }, []);

  function applyAiDraft(draft: { subject: string; body: string }) {
    setSubject(draft.subject);
    setBody(draft.body);
    setIsAiGenerated(true);
    setPendingAi(null);
    editedRef.current = false;
  }

  // `requested` = the user asked for this (Regenerate / Make it better / new
  // focus), so replace the text. The automatic first draft only replaces text
  // the user hasn't edited yet.
  async function generateWithAI(
    requested: boolean,
    options: { role?: string; improve?: { subject: string; body: string }; avoid?: { subject: string; body: string } } = {}
  ) {
    setError('');
    try {
      const profile = getProfile();
      const res = await authedFetch('/api/generate-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job, profile, ...options }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.subject && data.body) {
          setRole(data.role || 'general');
          setFactChecked(data.fact_checked !== false);
          const draft = { subject: data.subject, body: data.body };
          if (requested || !editedRef.current) applyAiDraft(draft);
          else setPendingAi(draft);
        }
      } else if (requested) {
        setError(await apiError(res, 'Could not rewrite it. Please try again.'));
      }
    } catch {
      // AI not available: keep the current version
      if (requested) setError('Could not reach the server. Please try again.');
    } finally {
      setAiLoading(false);
    }
  }

  function rework(options: Parameters<typeof generateWithAI>[1]) {
    setAiLoading(true);
    generateWithAI(true, options);
  }

  function handleCopy() {
    navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleCopyAndOpen() {
    navigator.clipboard.writeText(body);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    window.open(job.apply_url, '_blank');
  }

  function handleMailto() {
    const mailtoUrl = `mailto:${job.contact_email || ''}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.open(mailtoUrl);
  }

  async function handleSendEmail() {
    if (!job.contact_email) return;
    setSending(true);
    setError('');

    try {
      const res = await authedFetch('/api/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: job.contact_email, subject, body }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to send');
      }

      setSent(true);
      setTimeout(() => onClose(), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send email. Try copying instead.');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-100 bg-gradient-to-r from-indigo-50 to-purple-50 rounded-t-2xl">
          <div>
            <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
              {isAiGenerated ? (
                <>
                  <Sparkles size={18} className="text-indigo-500" />
                  AI-Generated Application
                </>
              ) : (
                'Application Message'
              )}
            </h2>
            <p className="text-sm text-indigo-600 font-medium">
              {job.title} at {job.company}
            </p>
            {job.contact_email && (
              <p className="text-xs text-gray-500 mt-0.5">
                <Mail size={11} className="inline mr-1" />
                {job.contact_email}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {aiLoading && (
              <span className="text-xs text-indigo-500 flex items-center gap-1">
                <Loader2 size={14} className="animate-spin" /> Generating with AI...
              </span>
            )}
            <button onClick={onClose} className="p-2 hover:bg-white/80 rounded-lg transition-colors">
              <X size={20} />
            </button>
          </div>
        </div>

        {/* AI controls */}
        <div className="flex flex-wrap items-center gap-2 px-5 pt-4">
          <label className="text-xs font-semibold text-gray-500 uppercase">Focus</label>
          <select
            value={role}
            onChange={(e) => {
              setRole(e.target.value);
              rework({ role: e.target.value });
            }}
            disabled={aiLoading || !role}
            className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-white disabled:opacity-60"
          >
            {!role && <option value="">Detecting...</option>}
            <option value="general">General</option>
            {ROLE_KEYS.map((key) => (
              <option key={key} value={key}>
                {ROLE_LABELS[key]}
              </option>
            ))}
          </select>
          <div className="flex gap-2 ml-auto">
            <button
              onClick={() => rework({ role: role || 'general', avoid: { subject, body } })}
              disabled={aiLoading}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 disabled:opacity-50 px-3 py-1.5 rounded-lg"
            >
              <RefreshCw size={14} /> Regenerate
            </button>
            <button
              onClick={() => rework({ role: role || 'general', improve: { subject, body } })}
              disabled={aiLoading}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 disabled:opacity-50 px-3 py-1.5 rounded-lg"
            >
              <Wand2 size={14} /> Make it better
            </button>
          </div>
        </div>

        {/* Form */}
        <div className="p-5 space-y-4">
          {pendingAi && (
            <div className="flex items-center justify-between gap-3 text-sm bg-indigo-50 border border-indigo-100 text-indigo-700 px-3 py-2 rounded-lg">
              <span className="flex items-center gap-1.5">
                <Sparkles size={14} /> AI draft is ready. You&apos;ve edited this one, so it wasn&apos;t replaced.
              </span>
              <span className="flex gap-2 shrink-0">
                <button onClick={() => applyAiDraft(pendingAi)} className="font-semibold hover:underline">
                  Use AI draft
                </button>
                <button onClick={() => setPendingAi(null)} className="text-indigo-500 hover:underline">
                  Keep mine
                </button>
              </span>
            </div>
          )}

          {isAiGenerated && !factChecked && (
            <p className="text-sm text-red-700 bg-red-50 border border-red-100 px-3 py-2 rounded-lg">
              This draft couldn&apos;t be fact-checked (the AI service had a problem). Read it carefully before sending, or click Regenerate.
            </p>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Subject</label>
            <input
              type="text"
              value={subject}
              onChange={(e) => {
                editedRef.current = true;
                setSubject(e.target.value);
              }}
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Message</label>
            <textarea
              value={body}
              onChange={(e) => {
                editedRef.current = true;
                setBody(e.target.value);
              }}
              rows={14}
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none resize-y font-mono leading-relaxed"
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
          )}

          {sent && (
            <p className="text-sm text-emerald-600 bg-emerald-50 px-3 py-2 rounded-lg font-medium">
              Message sent successfully!
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="p-5 border-t border-gray-100 bg-gray-50 rounded-b-2xl">
          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleCopyAndOpen}
              className="inline-flex items-center gap-2 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white px-5 py-2.5 rounded-lg text-sm font-semibold transition-all shadow-sm"
            >
              <ExternalLink size={16} />
              Copy & Apply
            </button>

            {job.contact_email && (
              <>
                <button
                  onClick={handleMailto}
                  className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2.5 rounded-lg text-sm font-semibold transition-colors"
                >
                  <Mail size={16} />
                  Open in Email App
                </button>
                <button
                  onClick={handleSendEmail}
                  disabled={sending || sent}
                  className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white px-5 py-2.5 rounded-lg text-sm font-semibold transition-colors"
                >
                  <Send size={16} />
                  {sending ? 'Sending...' : sent ? 'Sent!' : 'Send Directly'}
                </button>
              </>
            )}

            <button
              onClick={handleCopy}
              className="inline-flex items-center gap-2 bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 px-5 py-2.5 rounded-lg text-sm font-medium transition-colors"
            >
              {copied ? <Check size={16} className="text-emerald-500" /> : <Copy size={16} />}
              {copied ? 'Copied!' : 'Copy Only'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
