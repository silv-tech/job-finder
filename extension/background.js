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

// Seconds until a Supabase access token (JWT) expires. 0 if unreadable.
function tokenSecondsLeft(token) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload.exp ? payload.exp - Math.floor(Date.now() / 1000) : 0;
  } catch {
    return 0;
  }
}

// Refresh early so a token never expires mid-cycle.
const REFRESH_MARGIN_SECONDS = 10 * 60;

// Supabase refresh tokens are single-use, so two refreshes at once would log
// the user out. Everything (popup included) goes through this one promise.
let refreshInFlight = null;

// Result of making sure a usable token is in storage:
//   'ok'          token is valid (or was just refreshed)
//   'rejected'    Supabase refused the refresh token: really logged out
//   'unavailable' network / server problem: still logged in, try again later
//   'signed_out'  no tokens stored
async function refreshTokenIfNeeded(force = false) {
  const { authToken, authRefreshToken } = await chrome.storage.local.get(['authToken', 'authRefreshToken']);
  if (!authToken || !authRefreshToken) return 'signed_out';
  if (!force && tokenSecondsLeft(authToken) > REFRESH_MARGIN_SECONDS) return 'ok';

  if (!refreshInFlight) {
    refreshInFlight = refreshToken(authRefreshToken).finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

async function refreshToken(authRefreshToken) {
  const { config } = await chrome.storage.local.get('config');
  const apiUrl = config?.apiUrl || DEFAULT_CONFIG.apiUrl;
  try {
    const cfgRes = await fetch(`${apiUrl}/api/auth/supabase-config`);
    if (!cfgRes.ok) return 'unavailable';
    const { url: supabaseUrl, anonKey } = await cfgRes.json();

    const refreshRes = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': anonKey },
      body: JSON.stringify({ refresh_token: authRefreshToken }),
    });
    // 400/401 = Supabase says this refresh token is invalid or used up
    if (refreshRes.status === 400 || refreshRes.status === 401) return 'rejected';
    const data = await refreshRes.json();
    if (refreshRes.ok && data.access_token) {
      const update = { authToken: data.access_token, authRefreshToken: data.refresh_token };
      if (data.user?.email) update.userEmail = data.user.email;
      await chrome.storage.local.set(update);
      return 'ok';
    }
  } catch {}
  return 'unavailable';
}

// Get auth headers for API calls, refreshing the token first if it's close to
// expiring.
async function getAuthHeaders() {
  await refreshTokenIfNeeded();
  const { authToken } = await chrome.storage.local.get('authToken');
  const headers = { 'Content-Type': 'application/json' };
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }
  return headers;
}

// fetch() to our API with auth. On a 401 it force-refreshes the token and
// retries once, so an expired session never silently stops auto-apply.
async function apiFetch(url, init = {}) {
  let res = await fetch(url, { ...init, headers: await getAuthHeaders() });
  if (res.status === 401 && (await refreshTokenIfNeeded(true)) === 'ok') {
    res = await fetch(url, { ...init, headers: await getAuthHeaders() });
  }
  return res;
}

// Merge changed settings into the latest stored config. Callers send only the
// keys they changed, so a stale copy (e.g. a popup opened before "Sync
// Profile") can't overwrite newer values. Updates run one at a time.
let configWrite = Promise.resolve();
function mergeConfig(changes) {
  configWrite = configWrite.then(async () => {
    const { config } = await chrome.storage.local.get('config');
    await chrome.storage.local.set({ config: { ...DEFAULT_CONFIG, ...config, ...changes } });
  }).catch(() => {});
  return configWrite;
}

// Check if user is authenticated
async function isAuthenticated() {
  const { authToken } = await chrome.storage.local.get('authToken');
  return !!authToken;
}

// Chrome may drop alarms when the browser restarts, and they used to be
// created only on install (with the default interval, which also reset the
// user's interval on every extension update). Make sure both alarms exist and
// match the saved settings; creating an alarm with the same name replaces it.
async function ensureAlarms() {
  const { config } = await chrome.storage.local.get('config');
  const scanInterval = config?.scanInterval || DEFAULT_CONFIG.scanInterval;

  const scan = await chrome.alarms.get('autoScan');
  if (!scan || scan.periodInMinutes !== scanInterval) {
    await chrome.alarms.create('autoScan', { periodInMinutes: scanInterval });
  }
  if (!(await chrome.alarms.get('refreshToken'))) {
    await chrome.alarms.create('refreshToken', { periodInMinutes: 20 });
  }
}

// Initialize on install / update
chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.local.get('config');
  if (!existing.config) {
    await chrome.storage.local.set({ config: DEFAULT_CONFIG });
  }
  await ensureAlarms();
});

chrome.runtime.onStartup.addListener(() => {
  ensureAlarms();
});

// Also check whenever the service worker wakes up
ensureAlarms();

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
    const matchRes = await apiFetch(`${apiUrl}/api/extension/match-jobs`, {
      method: 'POST',
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
    mergeConfig(message.config).then(() => sendResponse({ success: true }));
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

  if (message.action === 'refreshAuth') {
    refreshTokenIfNeeded(!!message.force).then((status) => sendResponse({ ok: status === 'ok', status }));
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
        if (result?.sent) {
          // Give the send a moment to go through, then tidy up the hidden tab
          setTimeout(() => chrome.tabs.remove(tab.id).catch(() => {}), 5000);
        } else {
          // Review, manual step, or error: bring the tab forward so the user
          // can finish it instead of it sitting hidden
          await chrome.tabs.update(tab.id, { active: true }).catch(() => {});
          await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
        }
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
    const res = await apiFetch(`${apiUrl}/api/extension/match-jobs`, {
      method: 'POST',
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
    const res = await apiFetch(`${apiUrl}/api/extension/generate-application`, {
      method: 'POST',
      body: JSON.stringify({
        job,
        profile: config?.profile || DEFAULT_CONFIG.profile,
        form_fields: formFields,
      }),
    });

    if (res.status === 401) {
      return { error: 'Session expired. Please sign in again.' };
    }

    if (!res.ok) throw new Error(`API error: ${res.status}`);
    return await res.json();
  } catch (err) {
    return { error: err.message };
  }
}

async function handleSaveJob(job) {
  const { config } = await chrome.storage.local.get('config');
  const apiUrl = config?.apiUrl || DEFAULT_CONFIG.apiUrl;

  try {
    const res = await apiFetch(`${apiUrl}/api/saved-jobs`, {
      method: 'POST',
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
    const res = await apiFetch(`${apiUrl}/api/extension/match-jobs`, {
      method: 'POST',
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
