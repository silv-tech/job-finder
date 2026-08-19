import { Job } from './types';

const JSEARCH_BASE = 'https://jsearch.p.rapidapi.com';
const REMOTIVE_BASE = 'https://remotive.com/api';
const UPWORK_RSS_BASE = 'https://www.upwork.com/ab/feed/jobs/rss';

// --- JSearch API ---
async function searchJSearch(query: string, page: number = 1, remoteOnly: boolean = false, datePosted: string = 'week'): Promise<Job[]> {
  const apiKey = process.env.JSEARCH_API_KEY;
  if (!apiKey || apiKey === 'your_jsearch_api_key_here') return [];

  const params = new URLSearchParams({
    query,
    page: String(page),
    num_pages: '1',
    date_posted: datePosted,
    ...(remoteOnly ? { remote_jobs_only: 'true' } : {}),
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  const res = await fetch(`${JSEARCH_BASE}/search?${params}`, {
    headers: {
      'X-RapidAPI-Key': apiKey,
      'X-RapidAPI-Host': 'jsearch.p.rapidapi.com',
    },
    signal: controller.signal,
    next: { revalidate: 3600 },
  });
  clearTimeout(timeout);

  if (!res.ok) {
    console.error('JSearch error:', res.status, await res.text());
    return [];
  }

  const data = await res.json();
  return (data.data || []).map((item: Record<string, unknown>): Job => ({
    id: `jsearch_${item.job_id}`,
    title: (item.job_title as string) || '',
    company: (item.employer_name as string) || '',
    company_logo: item.employer_logo as string | undefined,
    location: item.job_is_remote
      ? 'Remote'
      : `${item.job_city || ''}, ${item.job_state || ''}, ${item.job_country || ''}`.replace(/^, |, $/g, ''),
    salary_min: item.job_min_salary as number | undefined,
    salary_max: item.job_max_salary as number | undefined,
    salary_currency: (item.job_salary_currency as string) || 'USD',
    description: (item.job_description as string) || '',
    short_description: ((item.job_description as string) || '').slice(0, 300) + '...',
    skills: extractSkills((item.job_description as string) || ''),
    job_type: (item.job_employment_type as string) || 'unknown',
    remote: !!item.job_is_remote,
    apply_url: (item.job_apply_link as string) || '',
    contact_email: extractEmail((item.job_description as string) || ''),
    source: 'jsearch',
    source_id: (item.job_id as string) || '',
    posted_at: (item.job_posted_at_datetime_utc as string) || new Date().toISOString(),
    created_at: new Date().toISOString(),
  }));
}

// --- Remotive API ---
async function searchRemotive(query: string): Promise<Job[]> {
  const params = new URLSearchParams({
    search: query,
    limit: '50',
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  const res = await fetch(`${REMOTIVE_BASE}/remote-jobs?${params}`, {
    signal: controller.signal,
    next: { revalidate: 3600 },
  });
  clearTimeout(timeout);

  if (!res.ok) {
    console.error('Remotive error:', res.status);
    return [];
  }

  const data = await res.json();
  return (data.jobs || []).map((item: Record<string, unknown>): Job => ({
    id: `remotive_${item.id}`,
    title: (item.title as string) || '',
    company: (item.company_name as string) || '',
    company_logo: item.company_logo as string | undefined,
    location: (item.candidate_required_location as string) || 'Remote',
    description: (item.description as string) || '',
    short_description: stripHtml((item.description as string) || '').slice(0, 300) + '...',
    skills: [...((item.tags as string[]) || []), ...extractSkills((item.description as string) || '')],
    job_type: (item.job_type as string) || 'full_time',
    remote: true,
    apply_url: (item.url as string) || '',
    contact_email: extractEmail((item.description as string) || ''),
    source: 'remotive',
    source_id: String(item.id),
    posted_at: (item.publication_date as string) || new Date().toISOString(),
    created_at: new Date().toISOString(),
  }));
}

// --- Upwork RSS Feed ---
function getXmlTagContent(xml: string, tag: string): string {
  const regex = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>|<${tag}[^>]*>([\\s\\S]*?)</${tag}>`);
  const match = xml.match(regex);
  if (!match) return '';
  return match[1] ?? match[2] ?? '';
}

function parseUpworkItems(xml: string): Array<Record<string, string>> {
  const items: Array<Record<string, string>> = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let itemMatch;
  while ((itemMatch = itemRegex.exec(xml)) !== null) {
    const block = itemMatch[1];
    items.push({
      title: getXmlTagContent(block, 'title'),
      link: getXmlTagContent(block, 'link'),
      description: getXmlTagContent(block, 'description'),
      pubDate: getXmlTagContent(block, 'pubDate'),
    });
  }
  return items;
}

function parseBudgetFromDescription(desc: string): { min?: number; max?: number } {
  // Upwork descriptions often contain "Budget: $X" or "Hourly Range: $X-$Y"
  const fixedMatch = desc.match(/Budget<\/b>:\s*\$([0-9,]+)/i);
  if (fixedMatch) {
    const val = parseInt(fixedMatch[1].replace(/,/g, ''), 10);
    return { min: val, max: val };
  }
  const hourlyMatch = desc.match(/Hourly Range<\/b>:\s*\$([0-9.]+)\s*-\s*\$([0-9.]+)/i);
  if (hourlyMatch) {
    return { min: parseFloat(hourlyMatch[1]), max: parseFloat(hourlyMatch[2]) };
  }
  return {};
}

async function searchUpwork(query: string): Promise<Job[]> {
  try {
    const params = new URLSearchParams({
      q: query,
      sort: 'recency',
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const res = await fetch(`${UPWORK_RSS_BASE}?${params}`, {
      signal: controller.signal,
      next: { revalidate: 3600 },
    });
    clearTimeout(timeout);

    if (!res.ok) {
      console.error('Upwork RSS error:', res.status);
      return [];
    }

    const xml = await res.text();
    const items = parseUpworkItems(xml);

    return items.map((item, index): Job => {
      const plainDesc = stripHtml(item.description || '');
      const budget = parseBudgetFromDescription(item.description || '');
      const isRemote = /remote/i.test(item.description || '') || /remote/i.test(item.title || '');
      // Upwork titles often have format "Title - Upwork" — clean that up
      const title = (item.title || '').replace(/\s*-\s*Upwork\s*$/i, '').trim();

      return {
        id: `upwork_${Date.now()}_${index}`,
        title,
        company: 'Upwork Client',
        location: isRemote ? 'Remote' : 'Upwork',
        salary_min: budget.min,
        salary_max: budget.max,
        salary_currency: 'USD',
        description: plainDesc,
        short_description: plainDesc.slice(0, 300) + '...',
        skills: extractSkills(plainDesc),
        job_type: 'contract',
        remote: true, // Upwork jobs are inherently remote
        apply_url: item.link || '',
        contact_email: extractEmail(plainDesc),
        source: 'upwork',
        source_id: item.link || `upwork_${index}`,
        posted_at: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
        created_at: new Date().toISOString(),
      };
    });
  } catch (err) {
    console.error('Upwork RSS fetch failed:', err);
    return [];
  }
}

// --- Himalayas API (free remote jobs) ---
async function searchHimalayas(query: string): Promise<Job[]> {
  try {
    const params = new URLSearchParams({
      limit: '50',
      q: query,
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const res = await fetch(`https://himalayas.app/jobs/api?${params}`, {
      signal: controller.signal,
      next: { revalidate: 3600 },
    });
    clearTimeout(timeout);

    if (!res.ok) {
      console.error('Himalayas error:', res.status);
      return [];
    }

    const data = await res.json();
    return (data.jobs || []).map((item: Record<string, unknown>, index: number): Job => ({
      id: `himalayas_${item.id || index}_${item.title || index}`,
      title: (item.title as string) || '',
      company: (item.companyName as string) || '',
      company_logo: item.companyLogo as string | undefined,
      location: (item.locationRestrictions as string) || 'Remote',
      description: stripHtml((item.description as string) || ''),
      short_description: stripHtml((item.excerpt as string) || (item.description as string) || '').slice(0, 300) + '...',
      skills: [...((item.categories as string[]) || []), ...extractSkills((item.description as string) || '')],
      job_type: (item.type as string) || 'full_time',
      remote: true,
      apply_url: (item.applicationLink as string) || (item.url as string) || '',
      contact_email: extractEmail((item.description as string) || ''),
      source: 'himalayas' as Job['source'],
      source_id: String(item.id),
      posted_at: (item.pubDate as string) || new Date().toISOString(),
      created_at: new Date().toISOString(),
    }));
  } catch (err) {
    console.error('Himalayas fetch failed:', err);
    return [];
  }
}

// Date filter helpers
function getDateCutoff(dateFilter: string): Date | null {
  const now = new Date();
  switch (dateFilter) {
    case 'today':
      return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    case '3days':
      return new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
    case 'week':
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    case 'month':
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    default:
      return null;
  }
}

// Map our filter to JSearch's date_posted param
function toJSearchDate(dateFilter: string): string {
  switch (dateFilter) {
    case 'today': return 'today';
    case '3days': return '3days';
    case 'week': return 'week';
    case 'month': return 'month';
    default: return 'month';
  }
}

// --- Combined search ---
export async function searchJobs(
  query: string,
  page: number = 1,
  remoteOnly: boolean = false,
  dateFilter: string = 'week'
): Promise<Job[]> {
  const [jsearchJobs, remotiveJobs, upworkJobs, himalayasJobs] = await Promise.all([
    searchJSearch(query, page, remoteOnly, toJSearchDate(dateFilter)),
    page === 1 ? searchRemotive(query) : Promise.resolve([]),
    page === 1 ? searchUpwork(query) : Promise.resolve([]),
    page === 1 ? searchHimalayas(query) : Promise.resolve([]),
  ]);

  const allJobs = [...jsearchJobs, ...remotiveJobs, ...upworkJobs, ...himalayasJobs];

  // Filter by date for non-JSearch sources (JSearch handles it server-side)
  const cutoff = getDateCutoff(dateFilter);
  const filtered = cutoff
    ? allJobs.filter((job) => {
        if (job.source === 'jsearch') return true; // already filtered
        try {
          return new Date(job.posted_at) >= cutoff;
        } catch {
          return true;
        }
      })
    : allJobs;

  // Deduplicate by title + company
  const seen = new Set<string>();
  const unique = filtered.filter((job) => {
    const key = `${job.title.toLowerCase()}_${job.company.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Prioritize jobs from known job platforms
  const PRIORITY_DOMAINS = [
    'linkedin.com',
    'upwork.com',
    'onlinejobs.ph',
    'jobstreet.com',
    'indeed.com',
    'glassdoor.com',
    'wellfound.com',       // AngelList / startup jobs
    'weworkremotely.com',
    'flexjobs.com',
    'toptal.com',
    'fiverr.com',
    'freelancer.com',
    'dice.com',
    'ziprecruiter.com',
    'monster.com',
    'remote.co',
    'remoteok.com',
    'remotive.com',
    'himalayas.app',
    'lever.co',
    'greenhouse.io',
    'workable.com',
    'breezy.hr',
  ];

  function getPriority(job: Job): number {
    const url = (job.apply_url || '').toLowerCase();
    const company = (job.company || '').toLowerCase();

    // Check if apply URL or company matches a known platform
    for (let i = 0; i < PRIORITY_DOMAINS.length; i++) {
      if (url.includes(PRIORITY_DOMAINS[i]) || company.includes(PRIORITY_DOMAINS[i].split('.')[0])) {
        return i; // lower = higher priority
      }
    }

    // Jobs with direct contact email get a boost
    if (job.contact_email) return PRIORITY_DOMAINS.length;

    // Everything else goes to the bottom
    return PRIORITY_DOMAINS.length + 1;
  }

  return unique.sort((a, b) => getPriority(a) - getPriority(b));
}

// --- Helpers ---
const TECH_SKILLS = [
  'javascript', 'typescript', 'python', 'react', 'next.js', 'nextjs', 'node.js', 'nodejs',
  'vue', 'angular', 'tailwind', 'css', 'html', 'git', 'github', 'docker', 'aws',
  'gcp', 'azure', 'postgresql', 'mysql', 'mongodb', 'redis', 'graphql', 'rest api',
  'ci/cd', 'linux', 'claude', 'ai', 'chatgpt', 'openai', 'llm', 'prompt engineering',
  'automation', 'web scraping', 'api', 'supabase', 'firebase', 'vercel', 'wordpress',
  'shopify', 'php', 'ruby', 'go', 'rust', 'java', 'c#', '.net', 'sql',
  'figma', 'no-code', 'zapier', 'make', 'n8n', 'airtable',
];

function extractSkills(text: string): string[] {
  const lower = text.toLowerCase();
  return TECH_SKILLS.filter((skill) => lower.includes(skill));
}

function extractEmail(text: string): string | undefined {
  const match = text.match(/[\w.+-]+@[\w-]+\.[\w.]+/);
  return match ? match[0] : undefined;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}
