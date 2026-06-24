'use client';

import { Job } from '@/lib/types';
import { getProfile, generateMessage } from '@/lib/profile';
import { X, Send, Copy, Check, ExternalLink, Mail } from 'lucide-react';
import { useState, useEffect } from 'react';

interface MessageModalProps {
  job: Job;
  onClose: () => void;
}

export default function MessageModal({ job, onClose }: MessageModalProps) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [copied, setCopied] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const profile = getProfile();
    const msg = generateMessage(profile, {
      title: job.title,
      company: job.company,
      description: job.description,
      skills: job.skills,
    });
    setSubject(msg.subject);
    setBody(msg.body);
  }, [job]);

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
      const res = await fetch('/api/message', {
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
            <h2 className="text-lg font-bold text-gray-900">Auto-Generated Application</h2>
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
          <button onClick={onClose} className="p-2 hover:bg-white/80 rounded-lg transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Form */}
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Subject</label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Message</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
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
            {/* Primary: Copy + Open Apply Page */}
            <button
              onClick={handleCopyAndOpen}
              className="inline-flex items-center gap-2 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white px-5 py-2.5 rounded-lg text-sm font-semibold transition-all shadow-sm"
            >
              <ExternalLink size={16} />
              Copy & Apply
            </button>

            {/* Email directly if contact available */}
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

            {/* Copy only */}
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
