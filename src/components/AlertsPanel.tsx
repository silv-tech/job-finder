'use client';

import { useState, useEffect } from 'react';
import { getAlerts, addAlert, removeAlert } from '@/lib/storage';
import { Bell, Plus, Trash2 } from 'lucide-react';

export default function AlertsPanel() {
  const [alerts, setAlerts] = useState<ReturnType<typeof getAlerts>>([]);
  const [keywords, setKeywords] = useState('');
  const [email, setEmail] = useState('');

  useEffect(() => {
    setAlerts(getAlerts());
  }, []);

  function handleAdd() {
    if (!keywords.trim() || !email.trim()) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return;
    addAlert(
      keywords.split(',').map((k) => k.trim()),
      email
    );
    setAlerts(getAlerts());
    setKeywords('');
  }

  function handleRemove(id: string) {
    removeAlert(id);
    setAlerts(getAlerts());
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5">
      <h2 className="flex items-center gap-2 text-lg font-semibold mb-4">
        <Bell size={20} /> Job Alerts
      </h2>

      <p className="text-sm text-gray-500 mb-4">
        Alerts are checked daily when deployed to Vercel. Add Resend + Supabase later to enable email notifications.
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
          disabled={!keywords.trim() || !email.trim()}
          className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          <Plus size={16} /> Add Alert
        </button>
      </div>

      {alerts.length === 0 ? (
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
