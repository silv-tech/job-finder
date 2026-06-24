'use client';

import { useState, useEffect } from 'react';
import { UserProfile, getProfile, saveProfile } from '@/lib/profile';
import { User, Save, Check, Plus, X } from 'lucide-react';

export default function ProfileSettings() {
  const [profile, setProfile] = useState<UserProfile>(getProfile());
  const [saved, setSaved] = useState(false);
  const [newSkill, setNewSkill] = useState('');

  useEffect(() => {
    setProfile(getProfile());
  }, []);

  function handleSave() {
    saveProfile(profile);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
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
      <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-900 mb-5">
          <div className="bg-indigo-100 p-1.5 rounded-lg">
            <User size={18} className="text-indigo-600" />
          </div>
          Your Profile
        </h2>
        <p className="text-sm text-gray-500 mb-5">
          This info is used to auto-generate personalized applications for every job.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
            <input
              type="text"
              value={profile.name}
              onChange={(e) => update('name', e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email"
              value={profile.email}
              onChange={(e) => update('email', e.target.value)}
              placeholder="your@email.com"
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
            <input
              type="tel"
              value={profile.phone}
              onChange={(e) => update('phone', e.target.value)}
              placeholder="+1 (555) 000-0000"
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Headline</label>
            <input
              type="text"
              value={profile.headline}
              onChange={(e) => update('headline', e.target.value)}
              placeholder="Full-Stack Developer | AI Specialist"
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Portfolio URL</label>
            <input
              type="url"
              value={profile.portfolio_url}
              onChange={(e) => update('portfolio_url', e.target.value)}
              placeholder="https://yourportfolio.com"
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">LinkedIn URL</label>
            <input
              type="url"
              value={profile.linkedin_url}
              onChange={(e) => update('linkedin_url', e.target.value)}
              placeholder="https://linkedin.com/in/yourprofile"
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Upwork Profile URL</label>
            <input
              type="url"
              value={profile.upwork_url}
              onChange={(e) => update('upwork_url', e.target.value)}
              placeholder="https://www.upwork.com/freelancers/~yourprofile"
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Resume URL</label>
            <input
              type="url"
              value={profile.resume_url}
              onChange={(e) => update('resume_url', e.target.value)}
              placeholder="https://drive.google.com/your-resume or direct link"
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
            />
          </div>
        </div>
      </div>

      {/* Skills */}
      <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
        <label className="block text-sm font-medium text-gray-700 mb-3">Your Skills</label>
        <div className="flex flex-wrap gap-2 mb-3">
          {profile.skills.map((skill, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1 text-sm bg-indigo-50 text-indigo-700 px-3 py-1 rounded-full font-medium"
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
            className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
          />
          <button
            onClick={addSkill}
            disabled={!newSkill.trim()}
            className="inline-flex items-center gap-1 bg-indigo-100 hover:bg-indigo-200 disabled:bg-gray-100 text-indigo-700 disabled:text-gray-400 px-3 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            <Plus size={16} /> Add
          </button>
        </div>
      </div>

      {/* Message Template */}
      <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
        <label className="block text-sm font-medium text-gray-700 mb-1">Message Template</label>
        <p className="text-xs text-gray-400 mb-3">
          Variables: {'{{job_title}}'}, {'{{company}}'}, {'{{matched_skills}}'}, {'{{skills_list}}'}, {'{{portfolio_line}}'}, {'{{linkedin_line}}'}, {'{{upwork_line}}'}, {'{{resume_line}}'}, {'{{name}}'}, {'{{email}}'}, {'{{phone}}'}, {'{{hiring_manager}}'}
        </p>
        <textarea
          value={profile.message_template}
          onChange={(e) => update('message_template', e.target.value)}
          rows={16}
          className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm font-mono focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none resize-y"
        />
      </div>

      <button
        onClick={handleSave}
        className={`inline-flex items-center gap-2 px-6 py-3 rounded-lg text-sm font-semibold transition-all shadow-sm ${
          saved
            ? 'bg-emerald-500 text-white'
            : 'bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white'
        }`}
      >
        {saved ? <Check size={18} /> : <Save size={18} />}
        {saved ? 'Saved!' : 'Save Profile'}
      </button>
    </div>
  );
}
