'use client';

import { useState, useEffect } from 'react';
import { Alert } from '@/lib/types';
import { Bell, Plus, Trash2, Loader2 } from 'lucide-react';

export default function AlertsPanel() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [keywords, setKeywords] = useState('');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchAlerts();
  }, []);

  async function fetchAlerts() {
    try {
      const res = await fetch('/api/alerts');
      const data = await res.json();
      setAlerts(data.alerts || []);
    } catch {
      setAlerts([]);
    } finally {
      setLoading(false);
    }
  }

  async function handleAdd() {
    if (!keywords.trim() || !email.trim()) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return;

    setSaving(true);
    try {
      const res = await fetch('/api/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keywords: keywords.split(',').map((k) => k.trim()),
          email,
        }),
      });
      if (res.ok) {
        await fetchAlerts();
        setKeywords('');
      }
    } catch {
      // Supabase not configured — silently fail
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove(id: string) {
    try {
      await fetch('/api/alerts', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      setAlerts((prev) => prev.filter((a) => a.id !== id));
    } catch {
      // Supabase not configured
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5">
      <h2 className="flex items-center gap-2 text-lg font-semibold mb-4">
        <Bell size={20} /> Job Alerts
      </h2>

      <p className="text-sm text-gray-500 mb-4">
        Get daily email notifications when new jobs match your keywords. Requires Supabase + Resend to be configured.
      </p>

      <div className="space-y-3 mb-4">
        <input
          type="text"
          value={keywords}
          onChange={(e) => setKeywords(e.target.value)}
          placeholder="Keywords (comma-separated): react, next.js, AI"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
        />
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Your email for alerts"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
        />
        <button
          onClick={handleAdd}
          disabled={!keywords.trim() || !email.trim() || saving}
          className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          {saving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
          {saving ? 'Adding...' : 'Add Alert'}
        </button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-gray-400 py-4">
          <Loader2 size={16} className="animate-spin" /> Loading alerts...
        </div>
      ) : alerts.length === 0 ? (
        <p className="text-sm text-gray-400">
          No alerts yet. Add keywords to get notified about new matching jobs.
        </p>
      ) : (
        <div className="space-y-2">
          {alerts.map((alert) => (
            <div
              key={alert.id}
              className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2"
            >
              <div>
                <div className="flex flex-wrap gap-1">
                  {alert.keywords.map((kw) => (
                    <span
                      key={kw}
                      className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded"
                    >
                      {kw}
                    </span>
                  ))}
                </div>
                <p className="text-xs text-gray-400 mt-1">{alert.email}</p>
              </div>
              <button
                onClick={() => handleRemove(alert.id)}
                className="p-1.5 hover:bg-red-100 text-gray-400 hover:text-red-600 rounded transition-colors"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
