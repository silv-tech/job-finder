'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { Loader2, Mail, Lock, ArrowRight, Download, Globe, Search, Zap, FileText, Send, Shield, BarChart3 } from 'lucide-react';

export default function LoginPage() {
  const { signIn, signUp, loading: authLoading } = useAuth();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [showAuth, setShowAuth] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [signupSuccess, setSignupSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !password) return;
    setError('');
    setLoading(true);

    try {
      if (mode === 'signup') {
        if (password.length < 6) {
          setError('Password must be at least 6 characters');
          setLoading(false);
          return;
        }
        const result = await signUp(email, password);
        if (result.error) {
          setError(result.error);
        } else {
          setSignupSuccess(true);
        }
      } else {
        const result = await signIn(email, password);
        if (result.error) {
          setError(result.error);
        }
      }
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 size={32} className="animate-spin text-slate-400" />
      </div>
    );
  }

  if (signupSuccess) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
        <div className="bg-white rounded-2xl border border-slate-200 p-8 w-full max-w-md text-center">
          <div className="bg-emerald-50 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Mail size={28} className="text-emerald-600" />
          </div>
          <h2 className="text-xl font-bold text-slate-900 mb-2">Check your email</h2>
          <p className="text-slate-500 mb-6">
            We sent a confirmation link to <strong>{email}</strong>. Click it to activate your account, then come back and log in.
          </p>
          <button
            onClick={() => { setSignupSuccess(false); setMode('login'); }}
            className="text-slate-900 font-semibold hover:underline"
          >
            Back to login
          </button>
        </div>
      </div>
    );
  }

  // Auth form (shown when "Get Started" is clicked)
  if (showAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <img src="/logo.png" alt="Job Finder" className="w-14 h-14 rounded-2xl mx-auto mb-4" />
            <h1 className="text-2xl font-bold text-slate-900">Job Finder</h1>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-8">
            <h2 className="text-lg font-bold text-slate-900 mb-6">
              {mode === 'login' ? 'Welcome back' : 'Create your account'}
            </h2>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
                <div className="relative">
                  <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    required
                    className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-slate-200 focus:border-slate-300 outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Password</label>
                <div className="relative">
                  <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={mode === 'signup' ? 'At least 6 characters' : 'Your password'}
                    required
                    minLength={6}
                    className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-slate-200 focus:border-slate-300 outline-none"
                  />
                </div>
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-xl text-sm">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading || !email || !password}
                className="w-full flex items-center justify-center gap-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-30 text-white py-2.5 rounded-xl text-sm font-semibold transition-all"
              >
                {loading ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <>
                    {mode === 'login' ? 'Sign In' : 'Create Account'}
                    <ArrowRight size={16} />
                  </>
                )}
              </button>
            </form>

            <div className="mt-6 text-center text-sm">
              {mode === 'login' ? (
                <p className="text-slate-500">
                  Don&apos;t have an account?{' '}
                  <button onClick={() => { setMode('signup'); setError(''); }} className="text-slate-900 font-semibold hover:underline">
                    Sign up
                  </button>
                </p>
              ) : (
                <p className="text-slate-500">
                  Already have an account?{' '}
                  <button onClick={() => { setMode('login'); setError(''); }} className="text-slate-900 font-semibold hover:underline">
                    Sign in
                  </button>
                </p>
              )}
            </div>
          </div>

          <button
            onClick={() => setShowAuth(false)}
            className="w-full mt-4 text-sm text-slate-400 hover:text-slate-600 transition-colors"
          >
            Back to home
          </button>
        </div>
      </div>
    );
  }

  // Landing page
  return (
    <div className="min-h-screen bg-slate-50">
      {/* Nav */}
      <nav className="bg-white border-b border-slate-200">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <img src="/logo.png" alt="Job Finder" className="w-8 h-8 rounded-xl" />
            <span className="text-lg font-bold text-slate-900">Job Finder</span>
          </div>
          <div className="flex items-center gap-3">
            <a
              href="/job-finder-extension.zip"
              download
              className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 transition-colors"
            >
              <Download size={14} />
              Extension
            </a>
            <button
              onClick={() => { setShowAuth(true); setMode('login'); }}
              className="text-sm text-slate-600 hover:text-slate-900 font-medium transition-colors"
            >
              Sign In
            </button>
            <button
              onClick={() => { setShowAuth(true); setMode('signup'); }}
              className="bg-slate-900 hover:bg-slate-800 text-white px-4 py-2 rounded-xl text-sm font-semibold transition-colors"
            >
              Get Started
            </button>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="max-w-5xl mx-auto px-4 pt-20 pb-16 text-center">
        <div className="inline-flex items-center gap-2 bg-white border border-slate-200 rounded-full px-4 py-1.5 text-xs font-medium text-slate-500 mb-6">
          <Zap size={12} className="text-amber-500" />
          AI-powered job applications
        </div>
        <h1 className="text-4xl md:text-5xl font-bold text-slate-900 leading-tight mb-4 tracking-tight">
          Stop applying manually.<br />Let AI do it for you.
        </h1>
        <p className="text-lg text-slate-500 max-w-2xl mx-auto mb-8 leading-relaxed">
          Job Finder scans job boards, matches listings to your skills, writes personalized applications, and submits them automatically. You review and approve, or let it run hands-free.
        </p>
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={() => { setShowAuth(true); setMode('signup'); }}
            className="bg-slate-900 hover:bg-slate-800 text-white px-6 py-3 rounded-xl text-sm font-semibold transition-colors inline-flex items-center gap-2"
          >
            Get Started Free
            <ArrowRight size={16} />
          </button>
          <a
            href="/job-finder-extension.zip"
            download
            className="bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 px-6 py-3 rounded-xl text-sm font-semibold transition-colors inline-flex items-center gap-2"
          >
            <Download size={16} />
            Download Extension
          </a>
        </div>
      </section>

      {/* How it works */}
      <section className="max-w-5xl mx-auto px-4 py-16">
        <h2 className="text-2xl font-bold text-slate-900 text-center mb-3">How it works</h2>
        <p className="text-slate-500 text-center mb-12 max-w-lg mx-auto">
          Three steps from job search to submitted application. No copy-pasting, no repetitive typing.
        </p>
        <div className="grid md:grid-cols-3 gap-6">
          <div className="bg-white rounded-2xl border border-slate-200 p-6">
            <div className="bg-slate-100 w-10 h-10 rounded-xl flex items-center justify-center mb-4">
              <Search size={18} className="text-slate-600" />
            </div>
            <h3 className="font-semibold text-slate-900 mb-2">1. Scan job listings</h3>
            <p className="text-sm text-slate-500 leading-relaxed">
              Browse OnlineJobs.ph (more sites coming soon). Click scan in the extension and it scrapes every listing on the page instantly.
            </p>
          </div>
          <div className="bg-white rounded-2xl border border-slate-200 p-6">
            <div className="bg-slate-100 w-10 h-10 rounded-xl flex items-center justify-center mb-4">
              <Zap size={18} className="text-slate-600" />
            </div>
            <h3 className="font-semibold text-slate-900 mb-2">2. AI matches and writes</h3>
            <p className="text-sm text-slate-500 leading-relaxed">
              AI scores each job against your profile. For matches, it reads the full description and writes a personalized application, answering every question the employer asks.
            </p>
          </div>
          <div className="bg-white rounded-2xl border border-slate-200 p-6">
            <div className="bg-slate-100 w-10 h-10 rounded-xl flex items-center justify-center mb-4">
              <Send size={18} className="text-slate-600" />
            </div>
            <h3 className="font-semibold text-slate-900 mb-2">3. Review and send</h3>
            <p className="text-sm text-slate-500 leading-relaxed">
              Preview the subject, message, and apply points before sending. One click to submit. Or turn on auto-apply and let it handle everything.
            </p>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="max-w-5xl mx-auto px-4 py-16">
        <h2 className="text-2xl font-bold text-slate-900 text-center mb-3">Built for real job seekers</h2>
        <p className="text-slate-500 text-center mb-12 max-w-lg mx-auto">
          Every feature is designed to save you hours of repetitive work.
        </p>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="bg-white rounded-2xl border border-slate-200 p-5 flex items-start gap-4">
            <div className="bg-slate-100 p-2.5 rounded-xl flex-shrink-0">
              <FileText size={18} className="text-slate-600" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-900 mb-1 text-sm">Personalized applications</h3>
              <p className="text-xs text-slate-500 leading-relaxed">
                Every message is unique. AI references specific job requirements, answers employer questions, and sounds like a real person.
              </p>
            </div>
          </div>
          <div className="bg-white rounded-2xl border border-slate-200 p-5 flex items-start gap-4">
            <div className="bg-slate-100 p-2.5 rounded-xl flex-shrink-0">
              <Shield size={18} className="text-slate-600" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-900 mb-1 text-sm">Hidden instruction detection</h3>
              <p className="text-xs text-slate-500 leading-relaxed">
                Many job posts include hidden tests like &quot;Put Orange in the subject.&quot; The AI catches and follows them automatically.
              </p>
            </div>
          </div>
          <div className="bg-white rounded-2xl border border-slate-200 p-5 flex items-start gap-4">
            <div className="bg-slate-100 p-2.5 rounded-xl flex-shrink-0">
              <BarChart3 size={18} className="text-slate-600" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-900 mb-1 text-sm">Skill matching scores</h3>
              <p className="text-xs text-slate-500 leading-relaxed">
                See how well each job matches your profile before applying. Focus your time on the best opportunities.
              </p>
            </div>
          </div>
          <div className="bg-white rounded-2xl border border-slate-200 p-5 flex items-start gap-4">
            <div className="bg-slate-100 p-2.5 rounded-xl flex-shrink-0">
              <Globe size={18} className="text-slate-600" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-900 mb-1 text-sm">Chrome extension</h3>
              <p className="text-xs text-slate-500 leading-relaxed">
                Works right inside your browser. No switching tabs, no copying text. Scan, match, fill, and send without leaving the job board.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-5xl mx-auto px-4 py-16 pb-24 text-center">
        <div className="bg-white rounded-2xl border border-slate-200 p-12">
          <h2 className="text-2xl font-bold text-slate-900 mb-3">Ready to automate your job search?</h2>
          <p className="text-slate-500 mb-6 max-w-md mx-auto">
            Create a free account, install the extension, and start applying to jobs in minutes.
          </p>
          <button
            onClick={() => { setShowAuth(true); setMode('signup'); }}
            className="bg-slate-900 hover:bg-slate-800 text-white px-6 py-3 rounded-xl text-sm font-semibold transition-colors inline-flex items-center gap-2"
          >
            Get Started Free
            <ArrowRight size={16} />
          </button>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white">
        <div className="max-w-5xl mx-auto px-4 py-6 flex items-center justify-between text-xs text-slate-400">
          <span>Job Finder</span>
          <span>Built by Leif</span>
        </div>
      </footer>
    </div>
  );
}
