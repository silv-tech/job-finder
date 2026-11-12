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
  // Real messages the user has written, used to ground applications in their
  // actual voice so they read as human rather than AI-generated.
  writing_samples?: string;
}

const DEFAULT_PROFILE: UserProfile = {
  name: 'Leif Soliva',
  email: 'leif@forgeaiagent.com',
  phone: '',
  portfolio_url: 'https://dlvasolutions.com/portfolio/',
  linkedin_url: 'https://www.linkedin.com/in/leifsoliva/',
  upwork_url: '',
  resume_url: '',
  headline: 'Full-Stack Developer, AI Builder & Operations Leader | 6+ Years Experience',
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
  bio: 'Full-stack developer and operations leader with 6+ years of experience. Shipped 9 products, managed 30+ people, and scaled monthly net sales from $40K to $200K (5x growth). I build websites, AI systems, and automation workflows that businesses depend on.',
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
  // The writer's prompt only includes a FULL RESUME block when this is set.
  // While it was unset every application was written from the one-line bio and
  // the skills list alone, which is why they all reached for the same three
  // numbers. Kept in sync with https://dlvasolutions.com/portfolio/ by hand.
  resume_text: "LEIF SOLIVA\nFull-Stack Developer, AI Builder & Operations Leader\nPhilippines (UTC+8). 6+ years experience. BS Information Technology, Ateneo de Davao University.\n\nHEADLINE NUMBERS\n- 9 products shipped and running\n- 30+ people managed\n- Scaled monthly net sales from $40,000 to $200,000 (5x) in a previous operations role\n\nPRODUCTS BUILT (his own work, safe to name)\n- RallyCam: court recording system for pickleball that cuts 8-second highlight clips automatically. React, Node.js, ffmpeg, TensorFlow.js pose detection, SQLite, WebSockets, Cloudflare R2, RTSP/ONVIF cameras, hardware encoding.\n- WhiteLabelAI: multi-tenant AI chatbot platform agencies resell under their own brand. Next.js, Express, Supabase, Claude API, Facebook Graph API, Railway.\n- Nocturne Monitors: real-time restock alerting for trading cards across 30+ Canadian retailers. Node.js, Discord.js, Redis, Express, Docker, web scraping.\n- Dark Sync: internet cafe management system. QR registration, POS, session tracking, analytics. React, Express, SQLite, Socket.io, Electron, Capacitor.\n- AgentForge / ForgeAI: automated cold outreach that researches a business and writes a personalised email per lead. Node.js, Claude API, Google Places, Railway, Resend.\n- DCTE Store: PC shop e-commerce with trade-in flow, loyalty points, and AI-generated listings from photos. Node.js, Express, JWT auth, Claude vision API.\n- H.U.B Store: PC builder storefront, 150+ products, GCash checkout, inventory system.\n- DLVASolutions: agency site for development, AI and VA services. Custom design, Netlify.\n- Pickleball Court Booking: client site with real-time court availability and reservations.\n\nWORK HISTORY (never name these employers in an application)\n- 2024-Present: Founder, own agency. 9 products shipped for clients and as own products.\n- 2024-2025: Operations Manager at a talent agency. Ran a team of 30+. Grew monthly net sales from $40,000 to $200,000.\n- 2021-2024: Project Manager at an AI company.\n- 2021-2023: AI Client Solutions Manager at an AI company.\n- 2020-2021: Customer service representative and appointment setting.\n\nTECHNICAL SKILLS\nFrontend: JavaScript, TypeScript, React, Next.js, HTML/CSS, Tailwind, PWA, Vite.\nBackend: Node.js, Express, Supabase, PostgreSQL, Redis, SQLite, WebSockets, Socket.io, REST APIs.\nAuth and security: JWT, bcrypt, sessions, rate limiting, security headers, CSP.\nAI and LLM: Claude API, OpenAI, chatbots, RAG, vision AI, prompt design, web scraping, email automation.\nVideo and vision: ffmpeg, RTSP/ONVIF, RTMP, TensorFlow.js pose detection, hardware encoding.\nPlatforms and deploy: Railway, Docker, Netlify, Vercel, Cloudflare, Electron, Capacitor, Git, CI/CD.\nIntegrations: Discord bots, Facebook Messenger, Google Places, GCash, Xendit, Stripe, Resend, Make, Zapier, n8n.\nOther: QR codes, geolocation, Leaflet maps, text-to-speech, PDF generation, monorepos, testing.\n\nOPERATIONS AND MANAGEMENT\nManaged 30+ people. Hiring, onboarding, scheduling, performance tracking, process documentation.\nClient-facing solutions work: scoping what a client needs and turning it into a shipped product.\n\nWHAT CLIENTS HAVE SAID\n- A PC shop CEO: \"Solid! I didn't expect it. He did more than what I asked for.\"\n- A storefront CEO: \"Great! I'm happy with your work. You really delivered and gave me what I wanted.\"\n- A monitoring service CEO: \"Top tier!\"\n- A mentor: \"It's crazy that you managed to build what was in your vision.\"",
  writing_samples: "These are short messages Leif wrote himself. They are chat messages about work, not letters to employers, so copy the VOICE and not the format or the typos.\n\n\"lets work on this, basically I want to update my extension on my chrome.\"\n\n\"Its good now, but I dont think that everything is perfectly working, I dont see it filling up applications automatically.\"\n\n\"Please figure this one, the extension is updated I believe, but as what I have said, I am using my macbook chrome for this, and basically I to use it here on my mac.\"\n\n\"Whatever you think is best, do it\"\n\n\"I dont see error as well at the manage extension channel.\"\n\n\"I usually write with very basic english grammar and I like it short and direct. I talk proud as well since I know I can deliver.\"\n\nWhat to take from these: short sentences. Plain everyday words, no vocabulary reaching. He says things straight out and gets to the point fast. He is sure of himself and does not soften what he can do. He says \"basically\" and \"as well\" a lot, which is fine in small doses but should not be a tic in an application.",
};

const STORAGE_KEY = 'job_finder_profile';
const PROFILE_VERSION = '6'; // bump this to reset profile to new defaults

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
          // Preserve imported/typed content across version bumps.
          resume_text: existing.resume_text || DEFAULT_PROFILE.resume_text,
          writing_samples: existing.writing_samples || DEFAULT_PROFILE.writing_samples,
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

  const body = profile.message_template
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
