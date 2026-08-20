export interface UserProfile {
  name: string;
  email: string;
  phone: string;
  portfolio_url: string;
  linkedin_url: string;
  upwork_url: string;
  resume_url: string;
  headline: string;
  skills: string[];
  bio: string;
  message_template: string;
  resume_text?: string;
}

const DEFAULT_PROFILE: UserProfile = {
  name: 'Leif Soliva',
  email: 'solivaaldon@gmail.com',
  phone: '',
  portfolio_url: 'https://dlvasolutions.com/portfolio/',
  linkedin_url: 'https://www.linkedin.com/in/leifsoliva/',
  upwork_url: '',
  resume_url: '',
  headline: 'Full-Stack Developer & AI Systems Builder | 6+ Years Experience',
  skills: [
    'JavaScript/TypeScript',
    'React & Next.js',
    'Python',
    'Node.js & Express',
    'AI/LLM Integration (Claude API, OpenAI)',
    'AI Chatbots & RAG Systems',
    'Supabase & PostgreSQL',
    'Tailwind CSS',
    'Web Scraping & Automation',
    'Make, Zapier & n8n',
    'REST APIs & WebSockets',
    'Stripe & Payment Integration',
    'Vercel, Railway & Netlify',
    'Git & CI/CD',
    'Electron & Capacitor (Desktop/Mobile)',
    'Team Management & Operations',
  ],
  bio: 'Full-stack developer and operations leader with 6+ years of experience. Shipped 7+ products, managed 30+ people, and scaled revenue from $40K to $200K/month (5x growth). I build websites, AI systems, and automation workflows that businesses depend on.',
  message_template: `Hi {{hiring_manager}},

I saw your listing for {{job_title}} at {{company}} and I think I'd be a great fit.

I've been building apps and systems for over 6 years now. I've launched 7+ products, managed teams of 30+ people, and helped scale a business from $40K to $200K a month. I'm good with {{matched_skills}}, and I pick things up fast.

Here's some of what I've built:
• AI chatbot platform that serves multiple businesses (WhiteLabelAI)
• Internet cafe management system with real-time monitoring (Dark Sync)
• AI lead generation and automation tools (ForgeAI)
• Online stores with Stripe and GCash payments
• AI voice receptionist for businesses

I'm best at taking ideas and turning them into working products quickly. I also have experience with hiring, managing teams, and setting up processes.

You can check out my work here:
{{portfolio_line}}
{{linkedin_line}}
{{upwork_line}}
{{resume_line}}

Let me know if you'd like to chat, I'm happy to jump on a call anytime.

{{name}}
{{email}}
{{phone}}`,
};

const STORAGE_KEY = 'job_finder_profile';
const PROFILE_VERSION = '4'; // bump this to reset profile to new defaults

export function getProfile(): UserProfile {
  if (typeof window === 'undefined') return DEFAULT_PROFILE;
  try {
    const ver = localStorage.getItem('job_finder_profile_version');
    const stored = localStorage.getItem(STORAGE_KEY);

    if (ver !== PROFILE_VERSION) {
      // New defaults available — merge with any user-customized fields
      localStorage.setItem('job_finder_profile_version', PROFILE_VERSION);
      if (stored) {
        const existing = JSON.parse(stored);
        // Keep user's custom values for basic fields, but update template and skills to new defaults
        const merged = {
          ...DEFAULT_PROFILE,
          name: existing.name || DEFAULT_PROFILE.name,
          email: existing.email || DEFAULT_PROFILE.email,
          phone: existing.phone || DEFAULT_PROFILE.phone,
          portfolio_url: existing.portfolio_url || DEFAULT_PROFILE.portfolio_url,
          linkedin_url: existing.linkedin_url || DEFAULT_PROFILE.linkedin_url,
          upwork_url: existing.upwork_url || DEFAULT_PROFILE.upwork_url,
          resume_url: existing.resume_url || DEFAULT_PROFILE.resume_url,
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
        return merged;
      }
      return DEFAULT_PROFILE;
    }

    if (!stored) return DEFAULT_PROFILE;
    return { ...DEFAULT_PROFILE, ...JSON.parse(stored) };
  } catch {
    return DEFAULT_PROFILE;
  }
}

export function saveProfile(profile: UserProfile) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
}

export function generateMessage(
  profile: UserProfile,
  job: { title: string; company: string; description: string; skills: string[] }
): { subject: string; body: string } {
  // Find skills that match between user and job
  const jobDesc = job.description.toLowerCase();
  const matchedSkills = profile.skills.filter((skill) =>
    jobDesc.includes(skill.toLowerCase().split('/')[0].split('&')[0].split('(')[0].trim())
  );
  const matchedText =
    matchedSkills.length > 0
      ? matchedSkills.slice(0, 4).join(', ')
      : profile.skills.slice(0, 3).join(', ');

  const skillsList = profile.skills
    .map((s) => `• ${s}`)
    .join('\n');

  const portfolioLine = profile.portfolio_url
    ? `Portfolio: ${profile.portfolio_url}`
    : '';
  const linkedinLine = profile.linkedin_url
    ? `LinkedIn: ${profile.linkedin_url}`
    : '';
  const upworkLine = profile.upwork_url
    ? `Upwork: ${profile.upwork_url}`
    : '';
  const resumeLine = profile.resume_url
    ? `Resume: ${profile.resume_url}`
    : '';

  let body = profile.message_template
    .replace(/\{\{hiring_manager\}\}/g, 'Hiring Manager')
    .replace(/\{\{job_title\}\}/g, job.title)
    .replace(/\{\{company\}\}/g, job.company)
    .replace(/\{\{matched_skills\}\}/g, matchedText)
    .replace(/\{\{skills_list\}\}/g, skillsList)
    .replace(/\{\{portfolio_line\}\}/g, portfolioLine)
    .replace(/\{\{linkedin_line\}\}/g, linkedinLine)
    .replace(/\{\{upwork_line\}\}/g, upworkLine)
    .replace(/\{\{resume_line\}\}/g, resumeLine)
    .replace(/\{\{name\}\}/g, profile.name)
    .replace(/\{\{email\}\}/g, profile.email)
    .replace(/\{\{phone\}\}/g, profile.phone)
    // Clean up empty lines from missing fields
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const subject = `Interested in ${job.title} role, ${profile.name}`;

  return { subject, body };
}
