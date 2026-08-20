'use client';

import { useState, useEffect, useRef } from 'react';
import { UserProfile, getProfile, saveProfile } from '@/lib/profile';
import { useAuth } from '@/lib/auth-context';
import { User, Save, Check, Plus, X, Upload, Loader2, FileText, Globe } from 'lucide-react';

export default function ProfileSettings() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<UserProfile>(getProfile());
  const [saved, setSaved] = useState(false);
  const [newSkill, setNewSkill] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [importUrl, setImportUrl] = useState('');
  const [importingUrl, setImportingUrl] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setProfile(getProfile());
  }, []);

  async function handleSave() {
    saveProfile(profile);
    try {
      await fetch('/api/extension/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...profile, user_id: user?.id }),
      });
    } catch {
      // Supabase not configured, still saved locally
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function handleResumeUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setUploadError('');

    try {
      const formData = new FormData();
      formData.append('resume', file);

      const res = await fetch('/api/parse-resume', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        setUploadError(data.error || 'Failed to parse resume');
        return;
      }

      if (data.profile) {
        // Merge parsed data with existing profile (don't overwrite non-empty fields with empty ones)
        setProfile((prev) => ({
          ...prev,
          name: data.profile.name || prev.name,
          email: data.profile.email || prev.email,
          phone: data.profile.phone || prev.phone,
          headline: data.profile.headline || prev.headline,
          skills: data.profile.skills?.length > 0 ? data.profile.skills : prev.skills,
          bio: data.profile.bio || prev.bio,
          portfolio_url: data.profile.portfolio_url || prev.portfolio_url,
          linkedin_url: data.profile.linkedin_url || prev.linkedin_url,
          upwork_url: data.profile.upwork_url || prev.upwork_url,
        }));
      }
    } catch {
      setUploadError('Failed to upload resume. Try again.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleUrlImport() {
    if (!importUrl.trim()) return;
    setImportingUrl(true);
    setUploadError('');

    try {
      const res = await fetch('/api/parse-resume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: importUrl.trim() }),
      });

      const data = await res.json();
      if (!res.ok) {
        setUploadError(data.error || 'Failed to import from URL');
        return;
      }

      if (data.profile) {
        setProfile((prev) => ({
          ...prev,
          name: data.profile.name || prev.name,
          email: data.profile.email || prev.email,
          phone: data.profile.phone || prev.phone,
          headline: data.profile.headline || prev.headline,
          skills: data.profile.skills?.length > 0 ? data.profile.skills : prev.skills,
          bio: data.profile.bio || prev.bio,
          portfolio_url: data.profile.portfolio_url || importUrl.trim() || prev.portfolio_url,
          linkedin_url: data.profile.linkedin_url || prev.linkedin_url,
          upwork_url: data.profile.upwork_url || prev.upwork_url,
        }));
        setImportUrl('');
      }
    } catch {
      setUploadError('Failed to import. Check the URL and try again.');
    } finally {
      setImportingUrl(false);
    }
  }

  function update(field: keyof UserProfile, value: string) {
    setProfile((p) => ({ ...p, [field]: value }));
  }

  function addSkill() {
    if (!newSkill.trim()) return;
    setProfile((p) => ({ ...p, skills: [...p.skills, newSkill.trim()] }));
    setNewSkill('');
  }

  function removeSkill(index: number) {
    setProfile((p) => ({ ...p, skills: p.skills.filter((_, i) => i !== index) }));
  }

  return (
    <div className="space-y-6">
      {/* Resume Upload */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900 mb-2">
          <div className="bg-slate-100 p-1.5 rounded-xl">
            <FileText size={18} className="text-slate-600" />
          </div>
          Quick Setup
        </h2>
        <p className="text-sm text-slate-500 mb-4">
          Upload your resume and AI will fill in your profile automatically.
        </p>

        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.txt,.md,.docx"
          onChange={handleResumeUpload}
          className="hidden"
        />

        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="inline-flex items-center gap-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white px-5 py-2.5 rounded-xl text-sm font-semibold transition-all"
        >
          {uploading ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              Parsing resume...
            </>
          ) : (
            <>
              <Upload size={16} />
              Upload Resume (PDF, TXT)
            </>
          )}
        </button>

        <div className="flex items-center gap-3 my-3">
          <div className="flex-1 h-px bg-slate-200"></div>
          <span className="text-xs text-slate-400">or</span>
          <div className="flex-1 h-px bg-slate-200"></div>
        </div>

        <div className="flex gap-2">
          <input
            type="url"
            value={importUrl}
            onChange={(e) => setImportUrl(e.target.value)}
            placeholder="Paste portfolio or LinkedIn URL"
            className="flex-1 border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-slate-200 focus:border-slate-300 outline-none"
          />
          <button
            onClick={handleUrlImport}
            disabled={importingUrl || !importUrl.trim()}
            className="inline-flex items-center gap-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-30 text-white px-4 py-2.5 rounded-xl text-sm font-semibold transition-all whitespace-nowrap"
          >
            {importingUrl ? <Loader2 size={14} className="animate-spin" /> : <Globe size={14} />}
            Import
          </button>
        </div>

        {uploadError && (
          <p className="text-sm text-red-600 mt-2">{uploadError}</p>
        )}
      </div>

      {/* Profile Fields */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900 mb-5">
          <div className="bg-slate-100 p-1.5 rounded-xl">
            <User size={18} className="text-slate-600" />
          </div>
          Your Profile
        </h2>
        <p className="text-sm text-slate-500 mb-5">
          This info is used to auto-generate personalized applications for every job.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Full Name</label>
            <input
              type="text"
              value={profile.name}
              onChange={(e) => update('name', e.target.value)}
              className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-slate-200 focus:border-slate-300 outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
            <input
              type="email"
              value={profile.email}
              onChange={(e) => update('email', e.target.value)}
              placeholder="your@email.com"
              className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-slate-200 focus:border-slate-300 outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Phone</label>
            <input
              type="tel"
              value={profile.phone}
              onChange={(e) => update('phone', e.target.value)}
              placeholder="+1 (555) 000-0000"
              className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-slate-200 focus:border-slate-300 outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Headline</label>
            <input
              type="text"
              value={profile.headline}
              onChange={(e) => update('headline', e.target.value)}
              placeholder="Full-Stack Developer | AI Specialist"
              className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-slate-200 focus:border-slate-300 outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Portfolio URL</label>
            <input
              type="url"
              value={profile.portfolio_url}
              onChange={(e) => update('portfolio_url', e.target.value)}
              placeholder="https://yourportfolio.com"
              className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-slate-200 focus:border-slate-300 outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">LinkedIn URL</label>
            <input
              type="url"
              value={profile.linkedin_url}
              onChange={(e) => update('linkedin_url', e.target.value)}
              placeholder="https://linkedin.com/in/yourprofile"
              className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-slate-200 focus:border-slate-300 outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Upwork Profile URL</label>
            <input
              type="url"
              value={profile.upwork_url}
              onChange={(e) => update('upwork_url', e.target.value)}
              placeholder="https://www.upwork.com/freelancers/~yourprofile"
              className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-slate-200 focus:border-slate-300 outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Resume URL</label>
            <input
              type="url"
              value={profile.resume_url}
              onChange={(e) => update('resume_url', e.target.value)}
              placeholder="https://drive.google.com/your-resume"
              className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-slate-200 focus:border-slate-300 outline-none"
            />
          </div>
        </div>
      </div>

      {/* Bio */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200">
        <label className="block text-sm font-medium text-slate-700 mb-1">Bio</label>
        <p className="text-xs text-slate-400 mb-3">A short summary about yourself. This is used in applications.</p>
        <textarea
          value={profile.bio}
          onChange={(e) => update('bio', e.target.value)}
          rows={4}
          className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-slate-200 focus:border-slate-300 outline-none resize-y"
        />
      </div>

      {/* Skills */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200">
        <label className="block text-sm font-medium text-slate-700 mb-3">Your Skills</label>
        <div className="flex flex-wrap gap-2 mb-3">
          {profile.skills.map((skill, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1 text-sm bg-slate-100 text-slate-700 px-3 py-1 rounded-xl font-medium"
            >
              {skill}
              <button onClick={() => removeSkill(i)} className="hover:text-red-500 ml-0.5">
                <X size={14} />
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={newSkill}
            onChange={(e) => setNewSkill(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addSkill()}
            placeholder="Add a skill (e.g. React, Python, AI)"
            className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-slate-200 focus:border-slate-300 outline-none"
          />
          <button
            onClick={addSkill}
            disabled={!newSkill.trim()}
            className="inline-flex items-center gap-1 bg-slate-100 hover:bg-slate-200 disabled:bg-slate-50 text-slate-700 disabled:text-slate-300 px-3 py-2 rounded-xl text-sm font-medium transition-colors"
          >
            <Plus size={16} /> Add
          </button>
        </div>
      </div>

      {/* Message Template */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200">
        <label className="block text-sm font-medium text-slate-700 mb-1">Message Template</label>
        <p className="text-xs text-slate-400 mb-3">
          Fallback template when AI is not available. Variables: {'{{job_title}}'}, {'{{company}}'}, {'{{matched_skills}}'}, {'{{name}}'}, {'{{email}}'}, {'{{phone}}'}
        </p>
        <textarea
          value={profile.message_template}
          onChange={(e) => update('message_template', e.target.value)}
          rows={12}
          className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-mono focus:ring-2 focus:ring-slate-200 focus:border-slate-300 outline-none resize-y"
        />
      </div>

      <button
        onClick={handleSave}
        className={`inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold transition-all ${
          saved
            ? 'bg-emerald-500 text-white'
            : 'bg-slate-900 hover:bg-slate-800 text-white'
        }`}
      >
        {saved ? <Check size={18} /> : <Save size={18} />}
        {saved ? 'Saved!' : 'Save Profile'}
      </button>
    </div>
  );
}
