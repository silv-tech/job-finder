// Background service worker for Job Finder Auto-Apply extension

const DEFAULT_CONFIG = {
  apiUrl: 'https://jobs.dlvasolutions.com',
  autoApply: false,
  scanInterval: 5,
  profile: {
    name: '',
    email: '',
    phone: '',
    portfolio_url: '',
    linkedin_url: '',
    headline: '',
    skills: [],
    bio: '',
  },
};

// Get auth headers for API calls, auto-refresh if needed
async function getAuthHeaders() {
  let { authToken } = await chrome.storage.local.get('authToken');
  const headers = { 'Content-Type': 'application/json' };
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }
  return headers;
}

async function refreshTokenIfNeeded() {
  const { authToken, authRefreshToken } = await chrome.storage.local.get(['authToken', 'authRefreshToken']);
  if (!authToken || !authRefreshToken) return false;

  const { config } = await chrome.storage.local.get('config');
  const apiUrl = config?.apiUrl || 'https://jobs.dlvasolutions.com';

  // Check if current token works
  try {
    const res = await fetch(`${apiUrl}/api/auth/session`, {
      headers: { 'Authorization': `Bearer ${authToken}` },
    });
    if (res.ok) return true;
  } catch {}

  // Token expired, refresh it
  try {
    const cfgRes = await fetch(`${apiUrl}/api/auth/supabase-config`);
    if (!cfgRes.ok) return false;
    const { url: supabaseUrl, anonKey } = await cfgRes.json();

    const refreshRes = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': anonKey },
      body: JSON.stringify({ refresh_token: authRefreshToken }),
    });
    const data = await refreshRes.json();
    if (refreshRes.ok && data.access_token) {
      await chrome.storage.local.set({
        authToken: data.access_token,
        authRefreshToken: data.refresh_token,
      });
      return true;
    }
  } catch {}
  return false;
}

// Check if user is authenticated
async function isAuthenticated() {
  const { authToken } = await chrome.storage.local.get('authToken');
  return !!authToken;
}

// Initialize on install
chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.local.get('config');
  if (!existing.config) {
    await chrome.storage.local.set({ config: DEFAULT_CONFIG });
  }
  chrome.alarms.create('autoScan', { periodInMinutes: DEFAULT_CONFIG.scanInterval });
  chrome.alarms.create('refreshToken', { periodInMinutes: 45 });
});

// Handle periodic tasks
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'refreshToken') {
    await refreshTokenIfNeeded();
    return;
  }

  if (alarm.name === 'autoScan') {
    if (!(await isAuthenticated())) return;

    const { config } = await chrome.storage.local.get('config');
    if (!config?.autoApply) return;
    if (!config?.autoApplyKeywords) return; // Need keywords to search

    // Open a fresh search in a hidden tab with newest results
    const keywords = encodeURIComponent(config.autoApplyKeywords);
    const searchUrl = `https://www.onlinejobs.ph/jobseekers/jobsearch?jobkeyword=${keywords}&gig=on&partTime=on&fullTime=on&isFromJobsearchForm=1`;
    const tab = await chrome.tabs.create({ url: searchUrl, active: false });

    await waitForTabLoad(tab.id);
    await sleep(3000); // Let JS render

    await handleAutoApplyCycle(tab.id);

    // Close the search tab after scanning
    try { await chrome.tabs.remove(tab.id); } catch {}
  }
});

// Full auto-apply cycle: scan page, match jobs, apply to recommended ones
async function handleAutoApplyCycle(tabId) {
  try {
    const { config } = await chrome.storage.local.get('config');

    // Step 1: Scrape current page
    let scrapeResult;
    try {
      scrapeResult = await chrome.tabs.sendMessage(tabId, { action: 'scrapeAndReport' });
    } catch {
      await sleep(2000);
      try {
        scrapeResult = await chrome.tabs.sendMessage(tabId, { action: 'scrapeAndReport' });
      } catch { return; }
    }

    const jobs = scrapeResult?.jobs || [];
    if (jobs.length === 0) return;

    // Step 2: Match jobs
    const apiUrl = config?.apiUrl || 'https://jobs.dlvasolutions.com';
    const headers = await getAuthHeaders();

    const matchRes = await fetch(`${apiUrl}/api/extension/match-jobs`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ jobs, profile: config?.profile || {}, min_score: config?.minApplyScore || 55 }),
    });

    if (!matchRes.ok) return;
    const matchData = await matchRes.json();

    const recommended = (matchData.matches || []).filter(m => m.should_apply);
    if (recommended.length === 0) return;

    await updateStats({ scanned: jobs.length, matched: matchData.matches?.length || 0 });

    // Step 3: Check for already-applied jobs
    const { appliedUrls = [] } = await chrome.storage.local.get('appliedUrls');
    const appliedSet = new Set(appliedUrls);
    const maxApplies = config?.maxAppliesPerCycle || 5;
    const minScore = config?.minApplyScore || 55;
    const toApply = recommended
      .filter(j => !appliedSet.has(j.apply_url) && (j.score || 0) >= minScore)
      .slice(0, maxApplies);

    if (toApply.length === 0) return;

    await applyToJobs(toApply);
  } catch {
    // Silent fail for background cycle
  }
}

// Guards against the alarm cycle and "Apply to All" running at the same time
let applyRunning = false;

async function markApplied(url) {
  const { appliedUrls = [] } = await chrome.storage.local.get('appliedUrls');
  if (!appliedUrls.includes(url)) {
    appliedUrls.push(url);
    await chrome.storage.local.set({ appliedUrls });
  }
}

async function unmarkApplied(url) {
  const { appliedUrls = [] } = await chrome.storage.local.get('appliedUrls');
  await chrome.storage.local.set({ appliedUrls: appliedUrls.filter(u => u !== url) });
}

// Apply to each job in a hidden tab (fill + send). Each URL is persisted as
// applied BEFORE sending, so a service-worker eviction mid-run can't cause a
// double application; it's un-marked only on a clean, retryable failure.
async function applyToJobs(jobs) {
  if (applyRunning) return { busy: true, applied: 0 };
  applyRunning = true;

  let appliedCount = 0;
  let bgTab;
  try {
    const { appliedUrls = [] } = await chrome.storage.local.get('appliedUrls');
    const alreadyApplied = new Set(appliedUrls);
    const pending = jobs.filter(j => j.apply_url && !alreadyApplied.has(j.apply_url));
    if (pending.length === 0) return { applied: 0 };

    bgTab = await chrome.tabs.create({ url: 'about:blank', active: false });

    for (const job of pending) {
      try {
        await chrome.tabs.update(bgTab.id, { url: job.apply_url });
        await waitForTabLoad(bgTab.id);
        await sleep(2500);

        // Click "Apply for this job" and get description
        let clickResult;
        try {
          clickResult = await chrome.tabs.sendMessage(bgTab.id, { action: 'clickApplyButton' });
        } catch {
          await sleep(2000);
          try {
            clickResult = await chrome.tabs.sendMessage(bgTab.id, { action: 'clickApplyButton' });
          } catch { continue; }
        }

        if (clickResult?.already_applied) {
          await markApplied(job.apply_url);
          continue;
        }

        if (clickResult?.description) {
          job.description = clickResult.description;
        }

        if (clickResult?.navigated) {
          await waitForTabLoad(bgTab.id);
          await sleep(2500);
        }

        // Point of no return: record before sending
        await markApplied(job.apply_url);

        let fillResult;
        try {
          fillResult = await chrome.tabs.sendMessage(bgTab.id, { action: 'autoFillAndSend', job });
        } catch {
          await sleep(2000);
          try {
            fillResult = await chrome.tabs.sendMessage(bgTab.id, { action: 'autoFillAndSend', job });
          } catch {
            // Unknown whether it sent; leave it marked rather than risk a duplicate
            continue;
          }
        }

        if (fillResult?.manual_required) {
          chrome.notifications.create({
            type: 'basic',
            title: 'Manual Action Needed',
            message: `"${job.title}" requires: ${(fillResult.requirements || ['manual steps']).join(', ')}`,
            iconUrl: 'icons/icon128.png',
          });
        } else if (fillResult?.success) {
          appliedCount++;
          await handleSaveJob(job);
          await logApplication(job);
        } else {
          // Content script reported a clean failure: allow a retry next time
          await unmarkApplied(job.apply_url);
        }

        await sleep(3000);
      } catch {
        continue;
      }
    }
  } finally {
    applyRunning = false;
    if (bgTab) { try { await chrome.tabs.remove(bgTab.id); } catch {} }
  }

  if (appliedCount > 0) {
    chrome.notifications.create({
      type: 'basic',
      title: 'Auto-Apply Complete',
      message: `Applied to ${appliedCount} job${appliedCount > 1 ? 's' : ''} automatically`,
      iconUrl: 'icons/icon128.png',
    });
  }
  return { applied: appliedCount };
}

// Handle messages from content scripts and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'matchJobs') {
    handleMatchJobs(message.jobs).then(sendResponse);
    return true;
  }

  if (message.action === 'generateApplication') {
    handleGenerateApplication(message.job, message.formFields).then(sendResponse);
    return true;
  }

  if (message.action === 'saveJob') {
    handleSaveJob(message.job).then(sendResponse);
    return true;
  }

  if (message.action === 'getConfig') {
    chrome.storage.local.get('config').then(({ config }) => sendResponse(config || DEFAULT_CONFIG));
    return true;
  }

  if (message.action === 'updateConfig') {
    chrome.storage.local.set({ config: message.config }).then(() => sendResponse({ success: true }));
    return true;
  }

  if (message.action === 'getStats') {
    chrome.storage.local.get('stats').then(({ stats }) => sendResponse(stats || { scanned: 0, matched: 0, applied: 0, today: new Date().toDateString() }));
    return true;
  }

  if (message.action === 'logApply') {
    logApplication(message.job).then(sendResponse);
    return true;
  }

  if (message.action === 'checkAuth') {
    isAuthenticated().then((authed) => sendResponse({ authenticated: authed }));
    return true;
  }

  if (message.action === 'setPendingApply') {
    chrome.storage.local.set({ pendingApply: message.job }).then(() => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.action === 'getPendingApply') {
    chrome.storage.local.get('pendingApply').then(({ pendingApply }) => {
      sendResponse({ job: pendingApply || null });
    });
    return true;
  }

  if (message.action === 'clearPendingApply') {
    chrome.storage.local.remove('pendingApply').then(() => sendResponse({ success: true }));
    return true;
  }

  if (message.action === 'autoScanWhenReady') {
    // Wait for the tab to load, then auto-scan
    handleAutoScanWhenReady(message.tabId).then(sendResponse);
    return true;
  }

  if (message.action === 'scanMultiplePages') {
    const tabId = message.tabId || sender.tab?.id;
    handleScanMultiplePages(message.baseUrl, message.maxPages, tabId).then(sendResponse);
    return true;
  }

  if (message.action === 'navigateAndApplyInTab') {
    handleNavigateAndApply(message.job, message.tabId).then(sendResponse);
    return true;
  }

  if (message.action === 'applyInNewTab') {
    (async () => {
      try {
        const tab = await chrome.tabs.create({ url: message.job.apply_url, active: false });
        const result = await handleNavigateAndApply(message.job, tab.id);
        sendResponse(result);
      } catch (err) {
        sendResponse({ error: err.message });
      }
    })();
    return true;
  }

  if (message.action === 'applyAllInBackground') {
    // Runs in a hidden tab so the sender page can navigate or close without
    // killing the loop. Respond immediately; completion comes as a notification.
    if (applyRunning) {
      sendResponse({ busy: true });
      return false;
    }
    applyToJobs(message.jobs || []);
    sendResponse({ started: true });
    return false;
  }

  if (message.action === 'navigateAndApply') {
    // Background orchestrates: navigate tab, wait for load, tell content script to apply
    handleNavigateAndApply(message.job, sender.tab.id).then(sendResponse);
    return true;
  }
});

async function handleMatchJobs(jobs) {
  if (!(await isAuthenticated())) {
    return { error: 'Not logged in. Open the extension and sign in first.', matches: [] };
  }

  const { config } = await chrome.storage.local.get('config');
  const apiUrl = config?.apiUrl || DEFAULT_CONFIG.apiUrl;

  try {
    const headers = await getAuthHeaders();
    const res = await fetch(`${apiUrl}/api/extension/match-jobs`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ jobs, profile: config?.profile || DEFAULT_CONFIG.profile, min_score: config?.minApplyScore || 55 }),
    });

    if (res.status === 401) {
      return { error: 'Session expired. Please sign in again.', matches: [] };
    }

    if (!res.ok) throw new Error(`API error: ${res.status}`);
    const data = await res.json();

    await updateStats({ scanned: jobs.length, matched: data.matches?.length || 0 });
    return data;
  } catch (err) {
    return { error: err.message, matches: [] };
  }
}

async function handleGenerateApplication(job, formFields) {
  if (!(await isAuthenticated())) {
    return { error: 'Not logged in' };
  }

  const { config } = await chrome.storage.local.get('config');
  const apiUrl = config?.apiUrl || DEFAULT_CONFIG.apiUrl;

  try {
    const profile = await getFreshProfile(config);
    const { backendV2 } = await chrome.storage.local.get('backendV2');
    const headers = await getAuthHeaders();
    const res = await fetch(`${apiUrl}/api/extension/generate-application`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        job,
        profile: backendV2 ? withWritingSamples(profile, config) : withVoiceInBio(profile, config),
        form_fields: formFields,
      }),
    });

    if (res.status === 401) {
      return { error: 'Session expired. Please sign in again.' };
    }

    if (!res.ok) throw new Error(`API error: ${res.status}`);
    const data = await res.json();
    if (data.engine === 'v2' && !backendV2) await chrome.storage.local.set({ backendV2: true });
    return humanizeApplication(data);
  } catch (err) {
    return { error: err.message };
  }
}

// ---- Application quality helpers -----------------------------------------

const PROFILE_TTL_MS = 6 * 60 * 60 * 1000;

// The local profile only updates when "Sync Profile" is clicked, so it's often
// blank or missing the resume. Refresh it from the app when stale so every
// application is written from the real, full profile.
async function getFreshProfile(config) {
  const local = config?.profile || {};
  const { profileSyncedAt = 0 } = await chrome.storage.local.get('profileSyncedAt');
  if (local.name && Date.now() - profileSyncedAt < PROFILE_TTL_MS) return local;

  try {
    const apiUrl = config?.apiUrl || DEFAULT_CONFIG.apiUrl;
    const res = await fetch(`${apiUrl}/api/extension/profile`, { headers: await getAuthHeaders() });
    if (!res.ok) return local;
    const { profile } = await res.json();
    if (!profile) return local;

    const merged = { ...local };
    for (const [k, v] of Object.entries(profile)) {
      const empty = v == null || v === '' || (Array.isArray(v) && v.length === 0);
      if (!empty) merged[k] = v;
    }
    const { config: current } = await chrome.storage.local.get('config');
    await chrome.storage.local.set({
      config: { ...(current || DEFAULT_CONFIG), profile: merged },
      profileSyncedAt: Date.now(),
    });
    return merged;
  } catch {
    return local;
  }
}

function writingSamplesFor(profile, config) {
  return (config?.writingSamples || profile.writing_samples || '').trim();
}

// Current backend: it reads writing_samples and has its own style rules.
function withWritingSamples(profile, config) {
  return { ...profile, writing_samples: writingSamplesFor(profile, config) };
}

// Older backend: it ignores writing_samples but always puts the bio into the
// prompt, so carry the voice samples and style notes there.
function withVoiceInBio(profile, config) {
  const samples = writingSamplesFor(profile, config);
  const notes = [
    'Notes on how I write applications:',
    '- Open with something specific from their post, not a greeting formula.',
    '- Mention one concrete thing I built that matches what they need, with the result.',
    '- Plain words, short sentences, no exclamation marks, no hype.',
    '- Subject line: short and specific to the role, the way a real person writes it. Never "HIRE ME" style.',
  ].join('\n');
  const voice = samples
    ? `\n\nReal messages I wrote. Match this voice, tone and sentence length, do not copy them:\n${samples.slice(0, 3000)}`
    : '';
  return { ...profile, bio: `${profile.bio || ''}\n\n${notes}${voice}`.trim() };
}

// Phrases that instantly read as AI or as a template. Removed whole-sentence.
const CANNED_SENTENCES = [
  /I hope (this|my) (message|email|note) finds you well\.?/gi,
  /I am writing to (express|apply)[^.!?]*[.!?]/gi,
  /I('m| am) (so |very |really )?(excited|thrilled|eager) (to|about)[^.!?]*[.!?]/gi,
  /Thank you (so much )?for (your )?(time and )?consideration[.!]?/gi,
  /I look forward to (hearing from you|the opportunity)[^.!?]*[.!?]/gi,
];

// Corporate/AI vocabulary -> plain words
const PLAIN_WORDS = [
  [/\butiliz(e|ed|ing)\b/gi, (m, s) => ({ e: 'use', ed: 'used', ing: 'using' })[s.toLowerCase()]],
  [/\bleverag(e|ed|ing)\b/gi, (m, s) => ({ e: 'use', ed: 'used', ing: 'using' })[s.toLowerCase()]],
  [/\bfacilitat(e|ed|ing)\b/gi, (m, s) => ({ e: 'help with', ed: 'helped with', ing: 'helping with' })[s.toLowerCase()]],
  [/\bspearhead(ed|ing)?\b/gi, (m, s) => (s ? ({ ed: 'led', ing: 'leading' })[s.toLowerCase()] : 'lead')],
  [/\borchestrat(e|ed|ing)\b/gi, (m, s) => ({ e: 'run', ed: 'ran', ing: 'running' })[s.toLowerCase()]],
  [/\bseamless(ly)?\b/gi, (m, s) => (s ? 'smoothly' : 'smooth')],
  [/\bpassionate about\b/gi, () => 'into'],
];

function humanizeText(text, { keepSentences = false } = {}) {
  if (typeof text !== 'string' || !text) return text;
  let t = text
    .replace(/\s*[—–]\s*/g, ', ')   // em/en dash
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, '...');
  if (!keepSentences) for (const re of CANNED_SENTENCES) t = t.replace(re, '');
  for (const [re, fn] of PLAIN_WORDS) {
    t = t.replace(re, (m, s) => {
      const out = fn(m, s || '');
      return m[0] === m[0].toUpperCase() ? out[0].toUpperCase() + out.slice(1) : out;
    });
  }
  if (!keepSentences) t = t.replace(/!+/g, '.');
  return t
    .replace(/,\s*,/g, ',')
    .replace(/ {2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\s*\n/, '')
    .trim();
}

// Final pass on whatever the backend returns. The subject keeps its words
// untouched (it may carry a required test word from the job post); only
// punctuation there is cleaned.
function humanizeApplication(app) {
  if (!app || app.error || app.manual_required) return app;
  const out = { ...app };
  if (out.subject) {
    out.subject = out.subject
      .replace(/\s*[—–]\s*/g, ', ')
      .replace(/!{2,}/g, '!')
      .trim();
  }
  // A hidden test instruction may require exact wording; never drop sentences then
  const opts = { keepSentences: !!out.hidden_instructions_found };
  if (out.cover_letter) out.cover_letter = humanizeText(out.cover_letter, opts);
  if (out.fields) {
    out.fields = Object.fromEntries(
      Object.entries(out.fields).map(([k, v]) => [k, humanizeText(v, opts)])
    );
  }
  return out;
}

async function handleSaveJob(job) {
  const { config } = await chrome.storage.local.get('config');
  const apiUrl = config?.apiUrl || DEFAULT_CONFIG.apiUrl;

  try {
    const headers = await getAuthHeaders();
    const res = await fetch(`${apiUrl}/api/saved-jobs`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        source_id: `onlinejobs_${job.id || Date.now()}`,
        source: 'onlinejobs_ph',
        title: job.title,
        company: job.company,
        location: job.location || 'Philippines',
        description: job.description,
        skills: job.skills || [],
        job_type: job.job_type || 'full-time',
        remote: true,
        apply_url: job.apply_url,
        posted_at: job.posted_at || new Date().toISOString(),
        status: 'applied',
      }),
    });

    return await res.json();
  } catch (err) {
    return { error: err.message };
  }
}

async function updateStats(add) {
  const { stats } = await chrome.storage.local.get('stats');
  const today = new Date().toDateString();
  const current = stats?.today === today ? stats : { scanned: 0, matched: 0, applied: 0, today };

  current.scanned += add.scanned || 0;
  current.matched += add.matched || 0;
  current.applied += add.applied || 0;

  await chrome.storage.local.set({ stats: current });
}

// Auto-scan a tab once it finishes loading
async function handleAutoScanWhenReady(tabId) {
  try {
    await waitForTabLoad(tabId);
    await sleep(2500); // Let JS render the job listings

    // Send scan command to the content script
    try {
      await chrome.tabs.sendMessage(tabId, { action: 'scanJobs' });
    } catch {
      await sleep(2000);
      await chrome.tabs.sendMessage(tabId, { action: 'scanJobs' });
    }

    return { success: true };
  } catch {
    return { error: 'Could not auto-scan' };
  }
}

// Orchestrate multi-page scanning using a hidden background tab
async function handleScanMultiplePages(baseUrl, maxPages, mainTabId) {
  try {
    const allJobs = [];
    const seenUrls = new Set();
    const pageBreakdown = [];

    // Step 1: Scrape page 1 from the main tab and get pagination links
    let result;
    try {
      result = await chrome.tabs.sendMessage(mainTabId, { action: 'scrapeAndReport' });
    } catch {
      await sleep(2000);
      result = await chrome.tabs.sendMessage(mainTabId, { action: 'scrapeAndReport' });
    }

    const page1Jobs = (result?.jobs || []).filter(j => {
      if (seenUrls.has(j.apply_url)) return false;
      seenUrls.add(j.apply_url);
      return true;
    });
    allJobs.push(...page1Jobs);
    pageBreakdown.push({ page: 1, count: page1Jobs.length });

    // Tell main tab to show progress
    try {
      await chrome.tabs.sendMessage(mainTabId, {
        action: 'showScanProgress',
        data: { currentPage: 1, maxPages, totalJobs: allJobs.length, pageBreakdown },
      });
    } catch {}

    // Get pagination URLs, deduplicated by page number
    const seenPages = new Set();
    const pageLinks = (result?.pageLinks || [])
      .filter(p => {
        if (p.page < 2 || p.page > maxPages || seenPages.has(p.page)) return false;
        seenPages.add(p.page);
        return true;
      })
      .sort((a, b) => a.page - b.page);

    if (pageLinks.length > 0) {
      // Step 2: Open a hidden tab for scraping other pages
      const bgTab = await chrome.tabs.create({ url: 'about:blank', active: false });

      for (const link of pageLinks) {
        // Navigate the hidden tab
        await chrome.tabs.update(bgTab.id, { url: link.url });
        await waitForTabLoad(bgTab.id);
        await sleep(2500);

        let pageResult;
        try {
          pageResult = await chrome.tabs.sendMessage(bgTab.id, { action: 'scrapeAndReport' });
        } catch {
          await sleep(2000);
          try {
            pageResult = await chrome.tabs.sendMessage(bgTab.id, { action: 'scrapeAndReport' });
          } catch {
            pageBreakdown.push({ page: link.page, count: 0 });
            // Update progress on main tab
            try {
              await chrome.tabs.sendMessage(mainTabId, {
                action: 'showScanProgress',
                data: { currentPage: link.page, maxPages, totalJobs: allJobs.length, pageBreakdown },
              });
            } catch {}
            continue;
          }
        }

        const pageJobs = (pageResult?.jobs || []).filter(j => {
          if (seenUrls.has(j.apply_url)) return false;
          seenUrls.add(j.apply_url);
          return true;
        });

        allJobs.push(...pageJobs);
        pageBreakdown.push({ page: link.page, count: pageJobs.length });

        // Update progress on main tab
        try {
          await chrome.tabs.sendMessage(mainTabId, {
            action: 'showScanProgress',
            data: { currentPage: link.page, maxPages, totalJobs: allJobs.length, pageBreakdown },
          });
        } catch {}

        if (pageJobs.length === 0) break;
      }

      // Close the hidden tab
      await chrome.tabs.remove(bgTab.id);
    }

    // Step 3: Match all collected jobs
    if (allJobs.length === 0) {
      return { error: 'No jobs found', totalJobs: 0, matches: [], pageBreakdown };
    }

    // Update main tab with matching status
    try {
      await chrome.tabs.sendMessage(mainTabId, {
        action: 'showScanProgress',
        data: { currentPage: 'matching', maxPages, totalJobs: allJobs.length, pageBreakdown },
      });
    } catch {}

    const { config } = await chrome.storage.local.get('config');
    const apiUrl = config?.apiUrl || 'https://jobs.dlvasolutions.com';
    const headers = await getAuthHeaders();

    const res = await fetch(`${apiUrl}/api/extension/match-jobs`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ jobs: allJobs, profile: config?.profile || {}, min_score: config?.minApplyScore || 55 }),
    });

    if (!res.ok) {
      return { error: `API error: ${res.status}`, totalJobs: allJobs.length, matches: [], pageBreakdown };
    }

    const data = await res.json();
    await updateStats({ scanned: allJobs.length, matched: data.matches?.length || 0 });

    // Step 4: Save results and show on main tab
    const matches = data.matches || [];
    await chrome.storage.local.set({ lastScanResults: matches, lastScanTime: Date.now() });

    try {
      await chrome.tabs.sendMessage(mainTabId, { action: 'showLastResults' });
    } catch {
      await sleep(1500);
      try { await chrome.tabs.sendMessage(mainTabId, { action: 'showLastResults' }); } catch {}
    }

    return { totalJobs: allJobs.length, matches, pageBreakdown };
  } catch (err) {
    return { error: err.message };
  }
}

// Orchestrate the full auto-apply flow from background
async function handleNavigateAndApply(job, tabId) {
  try {
    // Step 1: Navigate to the job detail page
    await chrome.tabs.update(tabId, { url: job.apply_url });
    await waitForTabLoad(tabId);
    await sleep(2000);

    // Step 2: Scrape description and click "APPLY FOR THIS JOB"
    let result;
    try {
      result = await chrome.tabs.sendMessage(tabId, { action: 'clickApplyButton' });
    } catch (e) {
      await sleep(2000);
      result = await chrome.tabs.sendMessage(tabId, { action: 'clickApplyButton' });
    }

    // Save the full description from the job detail page
    if (result?.description) {
      job.description = result.description;
    }

    if (result?.navigated) {
      await waitForTabLoad(tabId);
      await sleep(2000);
    }

    // Step 3: Fill the form, passing the job with full description
    try {
      const fillResult = await chrome.tabs.sendMessage(tabId, { action: 'fillApplyForm', job });
      return fillResult;
    } catch (e) {
      await sleep(2000);
      const fillResult = await chrome.tabs.sendMessage(tabId, { action: 'fillApplyForm', job });
      return fillResult;
    }
  } catch (err) {
    return { error: err.message };
  }
}

function waitForTabLoad(tabId) {
  return new Promise((resolve) => {
    function listener(updatedTabId, changeInfo) {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
    // Timeout after 15 seconds
    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, 15000);
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function logApplication(job) {
  await updateStats({ applied: 1 });

  chrome.notifications.create({
    type: 'basic',
    title: 'Application Sent',
    message: `Applied to "${job.title}" at ${job.company}`,
    iconUrl: 'icons/icon128.png',
  });

  return { success: true };
}
