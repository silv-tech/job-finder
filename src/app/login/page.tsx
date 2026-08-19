'use client';

import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/lib/auth-context';
import { Loader2, Mail, Lock, ArrowRight, Download, Globe, Search, Zap, FileText, Send, Shield, BarChart3, ChevronRight, Check } from 'lucide-react';

function useInView(ref: React.RefObject<HTMLElement | null>) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!ref.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setVisible(true); },
      { threshold: 0.15 }
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [ref]);
  return visible;
}

function FadeIn({ children, delay = 0, className = '' }: { children: React.ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const visible = useInView(ref);
  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(24px)',
        transition: `opacity 0.6s ease ${delay}s, transform 0.6s ease ${delay}s`,
      }}
    >
      {children}
    </div>
  );
}

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

  if (showAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
        <div className="w-full max-w-md" style={{ animation: 'fadeUp 0.4s ease' }}>
          <div className="text-center mb-8">
            <img src="/logo.png" alt="Job Finder" className="w-14 h-14 rounded-2xl mx-auto mb-4" />
            <h1 className="text-2xl font-bold text-slate-900">Job Finder</h1>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-8 shadow-sm">
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
                    className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-slate-200 focus:border-slate-300 outline-none transition-all"
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
                    className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-slate-200 focus:border-slate-300 outline-none transition-all"
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
                className="w-full flex items-center justify-center gap-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-30 text-white py-2.5 rounded-xl text-sm font-semibold transition-all hover:shadow-lg hover:shadow-slate-900/20"
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
      <style>{`
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-8px); }
        }
        @keyframes pulse-soft {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 0.8; }
        }
        .hero-glow {
          position: absolute;
          width: 500px;
          height: 500px;
          border-radius: 50%;
          filter: blur(120px);
          opacity: 0.15;
          pointer-events: none;
        }
        .card-hover {
          transition: all 0.3s ease;
        }
        .card-hover:hover {
          transform: translateY(-4px);
          box-shadow: 0 12px 40px rgba(0,0,0,0.06);
          border-color: #cbd5e1;
        }
        .step-number {
          position: absolute;
          top: -12px;
          right: -8px;
          width: 28px;
          height: 28px;
          background: #0f172a;
          color: white;
          border-radius: 10px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 12px;
          font-weight: 700;
        }
      `}</style>

      {/* Nav */}
      <nav className="bg-white/80 backdrop-blur-md border-b border-slate-200/60 sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <img src="/logo.png" alt="Job Finder" className="w-8 h-8 rounded-xl" />
            <span className="text-lg font-bold text-slate-900">Job Finder</span>
          </div>
          <div className="flex items-center gap-3">
            <a
              href="/job-finder-extension.zip"
              download
              className="hidden md:inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 transition-colors"
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
              className="bg-slate-900 hover:bg-slate-800 text-white px-4 py-2 rounded-xl text-sm font-semibold transition-all hover:shadow-lg hover:shadow-slate-900/20"
            >
              Get Started
            </button>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="hero-glow bg-blue-400" style={{ top: '-200px', left: '-100px' }} />
        <div className="hero-glow bg-violet-400" style={{ top: '-100px', right: '-150px' }} />

        <div className="max-w-5xl mx-auto px-4 pt-24 pb-20 text-center relative z-10">
          <div
            className="inline-flex items-center gap-2 bg-white border border-slate-200 rounded-full px-4 py-1.5 text-xs font-medium text-slate-500 mb-8 shadow-sm"
            style={{ animation: 'fadeUp 0.5s ease' }}
          >
            <Zap size={12} className="text-amber-500" />
            AI-powered job applications
          </div>
          <h1
            className="text-4xl md:text-6xl font-bold text-slate-900 leading-[1.1] mb-5 tracking-tight"
            style={{ animation: 'fadeUp 0.6s ease' }}
          >
            Stop applying manually.
            <br />
            <span className="bg-gradient-to-r from-slate-900 via-slate-700 to-slate-500 bg-clip-text text-transparent">
              Let AI do it for you.
            </span>
          </h1>
          <p
            className="text-lg text-slate-500 max-w-2xl mx-auto mb-10 leading-relaxed"
            style={{ animation: 'fadeUp 0.7s ease' }}
          >
            Job Finder scans job boards, matches listings to your skills, writes personalized applications, and submits them automatically.
          </p>
          <div
            className="flex flex-col sm:flex-row items-center justify-center gap-3"
            style={{ animation: 'fadeUp 0.8s ease' }}
          >
            <button
              onClick={() => { setShowAuth(true); setMode('signup'); }}
              className="bg-slate-900 hover:bg-slate-800 text-white px-7 py-3.5 rounded-xl text-sm font-semibold transition-all inline-flex items-center gap-2 hover:shadow-xl hover:shadow-slate-900/20 hover:scale-[1.02]"
            >
              Get Started Free
              <ArrowRight size={16} />
            </button>
            <a
              href="/job-finder-extension.zip"
              download
              className="bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 px-7 py-3.5 rounded-xl text-sm font-semibold transition-all inline-flex items-center gap-2 hover:shadow-lg hover:scale-[1.02]"
            >
              <Download size={16} />
              Download Extension
            </a>
          </div>

          {/* Stats */}
          <div
            className="flex items-center justify-center gap-8 mt-14 text-sm"
            style={{ animation: 'fadeUp 0.9s ease' }}
          >
            <div className="flex items-center gap-2 text-slate-400">
              <Check size={14} className="text-emerald-500" />
              Free to use
            </div>
            <div className="flex items-center gap-2 text-slate-400">
              <Check size={14} className="text-emerald-500" />
              AI-generated messages
            </div>
            <div className="flex items-center gap-2 text-slate-400">
              <Check size={14} className="text-emerald-500" />
              Chrome extension
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="max-w-5xl mx-auto px-4 py-20">
        <FadeIn className="text-center mb-14">
          <h2 className="text-3xl font-bold text-slate-900 mb-3">How it works</h2>
          <p className="text-slate-500 max-w-lg mx-auto">
            Three steps from job search to submitted application. No copy-pasting, no repetitive typing.
          </p>
        </FadeIn>
        <div className="grid md:grid-cols-3 gap-6">
          <FadeIn delay={0.1}>
            <div className="bg-white rounded-2xl border border-slate-200 p-7 card-hover relative">
              <div className="relative inline-block">
                <div className="bg-slate-100 w-12 h-12 rounded-xl flex items-center justify-center mb-5">
                  <Search size={20} className="text-slate-600" />
                </div>
                <div className="step-number">1</div>
              </div>
              <h3 className="font-semibold text-slate-900 mb-2 text-base">Scan job listings</h3>
              <p className="text-sm text-slate-500 leading-relaxed">
                Browse OnlineJobs.ph (more sites coming soon). Click scan in the extension and it scrapes every listing on the page instantly.
              </p>
            </div>
          </FadeIn>
          <FadeIn delay={0.2}>
            <div className="bg-white rounded-2xl border border-slate-200 p-7 card-hover relative">
              <div className="relative inline-block">
                <div className="bg-slate-100 w-12 h-12 rounded-xl flex items-center justify-center mb-5">
                  <Zap size={20} className="text-slate-600" />
                </div>
                <div className="step-number">2</div>
              </div>
              <h3 className="font-semibold text-slate-900 mb-2 text-base">AI matches and writes</h3>
              <p className="text-sm text-slate-500 leading-relaxed">
                AI scores each job against your profile. For matches, it reads the full description and writes a personalized application, answering every question the employer asks.
              </p>
            </div>
          </FadeIn>
          <FadeIn delay={0.3}>
            <div className="bg-white rounded-2xl border border-slate-200 p-7 card-hover relative">
              <div className="relative inline-block">
                <div className="bg-slate-100 w-12 h-12 rounded-xl flex items-center justify-center mb-5">
                  <Send size={20} className="text-slate-600" />
                </div>
                <div className="step-number">3</div>
              </div>
              <h3 className="font-semibold text-slate-900 mb-2 text-base">Review and send</h3>
              <p className="text-sm text-slate-500 leading-relaxed">
                Preview the subject, message, and apply points before sending. One click to submit. Or turn on auto-apply and let it handle everything.
              </p>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* Features */}
      <section className="max-w-5xl mx-auto px-4 py-20">
        <FadeIn className="text-center mb-14">
          <h2 className="text-3xl font-bold text-slate-900 mb-3">Built for real job seekers</h2>
          <p className="text-slate-500 max-w-lg mx-auto">
            Every feature is designed to save you hours of repetitive work.
          </p>
        </FadeIn>
        <div className="grid md:grid-cols-2 gap-4">
          <FadeIn delay={0.1}>
            <div className="bg-white rounded-2xl border border-slate-200 p-6 card-hover flex items-start gap-4">
              <div className="bg-gradient-to-br from-slate-100 to-slate-50 p-3 rounded-xl flex-shrink-0">
                <FileText size={20} className="text-slate-600" />
              </div>
              <div>
                <h3 className="font-semibold text-slate-900 mb-1">Personalized applications</h3>
                <p className="text-sm text-slate-500 leading-relaxed">
                  Every message is unique. AI references specific job requirements, answers employer questions, and sounds like a real person, not a template.
                </p>
              </div>
            </div>
          </FadeIn>
          <FadeIn delay={0.15}>
            <div className="bg-white rounded-2xl border border-slate-200 p-6 card-hover flex items-start gap-4">
              <div className="bg-gradient-to-br from-slate-100 to-slate-50 p-3 rounded-xl flex-shrink-0">
                <Shield size={20} className="text-slate-600" />
              </div>
              <div>
                <h3 className="font-semibold text-slate-900 mb-1">Hidden instruction detection</h3>
                <p className="text-sm text-slate-500 leading-relaxed">
                  Many job posts include hidden tests like &quot;Put Orange in the subject.&quot; The AI catches and follows them automatically so you never miss one.
                </p>
              </div>
            </div>
          </FadeIn>
          <FadeIn delay={0.2}>
            <div className="bg-white rounded-2xl border border-slate-200 p-6 card-hover flex items-start gap-4">
              <div className="bg-gradient-to-br from-slate-100 to-slate-50 p-3 rounded-xl flex-shrink-0">
                <BarChart3 size={20} className="text-slate-600" />
              </div>
              <div>
                <h3 className="font-semibold text-slate-900 mb-1">Skill matching scores</h3>
                <p className="text-sm text-slate-500 leading-relaxed">
                  See how well each job matches your profile before applying. Focus your time on the best opportunities, skip the rest.
                </p>
              </div>
            </div>
          </FadeIn>
          <FadeIn delay={0.25}>
            <div className="bg-white rounded-2xl border border-slate-200 p-6 card-hover flex items-start gap-4">
              <div className="bg-gradient-to-br from-slate-100 to-slate-50 p-3 rounded-xl flex-shrink-0">
                <Globe size={20} className="text-slate-600" />
              </div>
              <div>
                <h3 className="font-semibold text-slate-900 mb-1">Chrome extension</h3>
                <p className="text-sm text-slate-500 leading-relaxed">
                  Works right inside your browser. No switching tabs, no copying text. Scan, match, fill, and send without leaving the job board.
                </p>
              </div>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-5xl mx-auto px-4 py-20 pb-28">
        <FadeIn>
          <div className="relative bg-slate-900 rounded-3xl p-14 text-center overflow-hidden">
            <div className="hero-glow bg-blue-500" style={{ top: '-200px', right: '-100px', opacity: 0.2 }} />
            <div className="hero-glow bg-violet-500" style={{ bottom: '-200px', left: '-100px', opacity: 0.15 }} />
            <div className="relative z-10">
              <h2 className="text-3xl font-bold text-white mb-3">Ready to automate your job search?</h2>
              <p className="text-slate-400 mb-8 max-w-md mx-auto">
                Create a free account, install the extension, and start applying to jobs in minutes.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                <button
                  onClick={() => { setShowAuth(true); setMode('signup'); }}
                  className="bg-white hover:bg-slate-100 text-slate-900 px-7 py-3.5 rounded-xl text-sm font-semibold transition-all inline-flex items-center gap-2 hover:shadow-xl hover:scale-[1.02]"
                >
                  Get Started Free
                  <ChevronRight size={16} />
                </button>
                <a
                  href="/job-finder-extension.zip"
                  download
                  className="border border-slate-700 hover:border-slate-500 text-slate-300 hover:text-white px-7 py-3.5 rounded-xl text-sm font-semibold transition-all inline-flex items-center gap-2"
                >
                  <Download size={16} />
                  Download Extension
                </a>
              </div>
            </div>
          </div>
        </FadeIn>
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
