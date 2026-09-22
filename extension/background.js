// Background service worker for Job Finder Auto-Apply extension

const DEFAULT_CONFIG = {
  apiUrl: 'https://jobs.dlvasolutions.com',
  autoApply: false,
  scanInterval: 10,
  // The four kinds of job worth applying to, searched one per cycle.
  lanes: ['developer', 'automations', 'management', 'exec_assistant', 'general_va'],
  // A job post is a drop: the value is in being early. Anything older than this
  // has already been buried by other applicants, so don't spend a point on it.
  maxJobAgeHours: 24,
  // Apply Points refill at 10 a day and the balance caps at 60, so spending is
  // the real limit. Defaults keep us inside one day's income.
  dailyApBudget: 10,
  maxAppliesPerDay: 10,
  apReserve: 0,
  minApplyScore: 60,
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

// What to type into the onlinejobs.ph search box for each lane. Scoring lives
// server-side in src/lib/lanes.ts; this is only the search text.
const LANE_SEARCHES = {
  developer: ['web developer', 'full stack developer', 'javascript developer', 'ai automation developer'],
  automations: ['automation', 'zapier automation', 'n8n automation', 'ai automation specialist'],
  management: ['operations manager', 'team manager', 'project manager'],
  exec_assistant: ['executive assistant', 'chief of staff', 'right hand assistant'],
  general_va: ['virtual assistant', 'data entry', 'admin assistant'],
};

// --- Apply Points budget ----------------------------------------------------
// Everything the auto-apply cycle does answers to this. onlinejobs.ph runs on
// Philippine time, so the daily counters roll over when the site's day does.

function phtDayKey(when) {
  const t = (when || new Date()).getTime() + 8 * 3600 * 1000;
  return new Date(t).toISOString().slice(0, 10);
}

async function getBudget() {
  const stored = (await chrome.storage.local.get('budget')).budget;
  const today = phtDayKey();
  if (!stored || stored.day !== today) {
    // Carry the last observed balance across the day boundary; it is refreshed
    // for real the next time an apply page tells us the true number.
    const fresh = { day: today, applied: 0, apSpent: 0, apBalance: stored ? stored.apBalance : null };
    await chrome.storage.local.set({ budget: fresh });
    return fresh;
  }
  return stored;
}

// The apply page shows the real balance. That reading beats any estimate.
async function recordApBalance(balance) {
  if (typeof balance !== 'number' || !isFinite(balance) || balance < 0) return;
  const b = await getBudget();
  b.apBalance = balance;
  await chrome.storage.local.set({ budget: b });
}

// Can we afford to send one more application worth `ap` points right now?
async function budgetAllows(ap) {
  const { config } = await chrome.storage.local.get('config');
  const maxApplies = config && config.maxAppliesPerDay != null ? config.maxAppliesPerDay : DEFAULT_CONFIG.maxAppliesPerDay;
  const apBudget = config && config.dailyApBudget != null ? config.dailyApBudget : DEFAULT_CONFIG.dailyApBudget;
  const reserve = config && config.apReserve != null ? config.apReserve : DEFAULT_CONFIG.apReserve;
  const b = await getBudget();

  if (b.applied >= maxApplies) return { ok: false, reason: 'daily application cap reached (' + b.applied + '/' + maxApplies + ')' };
  if (b.apSpent + ap > apBudget) return { ok: false, reason: 'daily Apply Point budget spent (' + b.apSpent + '/' + apBudget + ')' };
  if (b.apBalance != null && b.apBalance - ap < reserve) return { ok: false, reason: 'Apply Point balance too low (' + b.apBalance + ' left)' };
  return { ok: true };
}

async function recordSpend(ap) {
  const b = await getBudget();
  b.applied += 1;
  b.apSpent += ap;
  if (b.apBalance != null) b.apBalance = Math.max(0, b.apBalance - ap);
  await chrome.storage.local.set({ budget: b });
}

// One lane per cycle. The first lane is checked every other cycle because it is
// the one he most wants and posts there go stale fastest; a flat rotation would
// only reach it once every four cycles.
function laneOrder(lanes) {
  if (lanes.length <= 1) return lanes.slice();
  const primary = lanes[0];
  const rest = lanes.slice(1);
  const order = [];
  for (const other of rest) { order.push(primary); order.push(other); }
  return order; // e.g. dev, mgmt, dev, ea, dev, va
}

async function nextLaneAndSearch(config) {
  const lanes = (config && config.lanes && config.lanes.length) ? config.lanes : DEFAULT_CONFIG.lanes;
  const order = laneOrder(lanes);
  const stored = await chrome.storage.local.get('laneCursor');
  const cursor = stored.laneCursor || 0;
  const lane = order[cursor % order.length];
  const searches = LANE_SEARCHES[lane] || [lane];
  // Vary the search text each time this lane comes round, so one phrasing does
  // not hide posts the others would surface.
  const round = Math.floor(cursor / order.length);
  const search = searches[round % searches.length];
  await chrome.storage.local.set({ laneCursor: (cursor + 1) % (order.length * searches.length * 4) });
  return { lane, search };
}

// How old a post is, in hours, from the card's timestamp. Philippine time, as
// the site publishes it. null when the post carries no usable timestamp.
function jobAgeHours(posted_at) {
  if (!posted_at) return null;
  const m = String(posted_at).match(/(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return null;
  const [, y, mo, d, hh, mm, ss] = m;
  // Build the instant as PHT (UTC+8) regardless of the machine's own timezone.
  const postedUtcMs = Date.UTC(+y, +mo - 1, +d, +(hh || 0), +(mm || 0), +(ss || 0)) - 8 * 3600 * 1000;
  const age = (Date.now() - postedUtcMs) / 3600000;
  return isFinite(age) ? age : null;
}

// Drop the stale ones. A post with no timestamp is kept: better to score it
// than to silently discard a job that might be minutes old.
function filterFresh(jobs, maxAgeHours) {
  if (!maxAgeHours) return jobs;
  return jobs.filter((j) => {
    const age = jobAgeHours(j.posted_at);
    return age === null || age <= maxAgeHours;
  });
}

// Jobs already scored in an earlier cycle. Anything not in here is new, which
// is a more reliable "is this a fresh post" test than the card's date, which
// has no time of day on it.
async function filterUnseen(jobs) {
  const stored = await chrome.storage.local.get('seenUrls');
  const seen = new Set(stored.seenUrls || []);
  const fresh = jobs.filter((j) => j.apply_url && !seen.has(j.apply_url));
  for (const j of jobs) if (j.apply_url) seen.add(j.apply_url);
  // Keep the list from growing without bound.
  const trimmed = [...seen].slice(-4000);
  await chrome.storage.local.set({ seenUrls: trimmed });
  return fresh;
}

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
  const release = keepAwake(); // AI calls can take longer than Chrome's idle limit
  try {
    let res = await fetch(url, { ...init, headers: await getAuthHeaders() });
    if (res.status === 401 && (await refreshTokenIfNeeded(true)) === 'ok') {
      res = await fetch(url, { ...init, headers: await getAuthHeaders() });
    }
    return res;
  } finally {
    release();
  }
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

// Lanes added in a later version would otherwise stay switched off forever:
// the popup ticks each box from the stored list, and an existing config has no
// entry for a lane that did not exist when it was saved. Add the new ones once.
const LANES_ADDED_LATER = ['automations'];

async function migrateLanes() {
  const { config } = await chrome.storage.local.get('config');
  if (!config || !Array.isArray(config.lanes)) return; // defaults already cover it
  const missing = LANES_ADDED_LATER.filter((k) => !config.lanes.includes(k));
  if (missing.length === 0) return;
  // Keep the user's order, and slot each new lane where DEFAULT_CONFIG has it.
  const merged = DEFAULT_CONFIG.lanes.filter((k) => config.lanes.includes(k) || missing.includes(k));
  await chrome.storage.local.set({ config: { ...config, lanes: merged } });
  console.log('[JF] enabled newly added lanes:', missing.join(', '));
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
migrateLanes();
// A fresh worker means any saved run belongs to a worker Chrome shut down
recoverInterruptedRun();

// Handle periodic tasks
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'refreshToken') {
    await refreshTokenIfNeeded();
    return;
  }

  if (alarm.name === 'autoScan') {
    await runAutoApplyCycle('schedule');
  }
});

// Every stop in here used to be a silent return, which made a cycle that did
// nothing indistinguishable from one that never ran. Each outcome is now
// recorded so the popup can say exactly where it stopped.
async function recordCycle(status, detail) {
  await chrome.storage.local.set({
    lastCycle: { at: new Date().toISOString(), status, detail: detail || '' },
  });
  console.log('[JF] cycle:', status, detail || '');
}

async function runAutoApplyCycle(trigger) {
  {
    if (!(await isAuthenticated())) {
      await recordCycle('not signed in', 'sign in from the extension popup');
      return;
    }

    const { config } = await chrome.storage.local.get('config');
    if (!config?.autoApply) {
      await recordCycle('auto-apply is off', 'turn on Auto-Apply Mode');
      return;
    }

    // Nothing to do if today's budget is already spent: don't even open a tab.
    const spare = await budgetAllows(1);
    if (!spare.ok) {
      await recordCycle('budget stopped it', spare.reason);
      return;
    }

    // One lane per cycle, rotating, so all four get covered.
    const { lane, search } = await nextLaneAndSearch(config);
    // The lane's own search wins. A hand-set keyword is a legacy override and
    // only applies when lane rotation is switched off, otherwise every cycle
    // would search the same thing and the other three lanes would never run.
    const useLanes = !config.lanes || config.lanes.length > 0;
    const keywords = encodeURIComponent(useLanes ? search : (config.autoApplyKeywords || search));
    const searchUrl = `https://www.onlinejobs.ph/jobseekers/jobsearch?jobkeyword=${keywords}&gig=on&partTime=on&fullTime=on&isFromJobsearchForm=1`;
    // Recorded BEFORE the work, so the specific outcome below replaces it
    // rather than the other way round. Overwriting afterwards destroyed the
    // very diagnosis this exists to give.
    await recordCycle('searching (' + trigger + ')', search);
    const tab = await chrome.tabs.create({ url: searchUrl, active: false });

    await waitForTabLoad(tab.id);
    await sleep(3000); // Let JS render

    // With no lanes ticked the search comes from the keyword box, so there is
    // no lane to score against: let the API judge each job against all four.
    await handleAutoApplyCycle(tab.id, useLanes ? lane : null);

    // Close the search tab after scanning
    try { await chrome.tabs.remove(tab.id); } catch {}
  }
}

// Full auto-apply cycle: scan page, match jobs, apply to recommended ones
async function handleAutoApplyCycle(tabId, lane) {
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
      } catch {
        await recordCycle('could not read the page', 'the search page did not respond');
        return;
      }
    }

    const allJobs = scrapeResult?.jobs || [];
    if (allJobs.length === 0) {
      await recordCycle('no jobs on the page', 'the search returned nothing');
      return;
    }

    // Only look at posts we have not already scored in an earlier cycle, and
    // only while they are still fresh enough to be worth a point.
    const maxAge = config?.maxJobAgeHours ?? DEFAULT_CONFIG.maxJobAgeHours;
    const unseen = await filterUnseen(allJobs);
    const jobs = filterFresh(unseen, maxAge);
    if (jobs.length === 0) {
      await recordCycle('nothing new', `${allJobs.length} on the page, all already seen or older than ${maxAge}h`);
      return;
    }

    // Step 2: Match jobs
    const apiUrl = config?.apiUrl || 'https://jobs.dlvasolutions.com';
    const matchRes = await apiFetch(`${apiUrl}/api/extension/match-jobs`, {
      method: 'POST',
      body: JSON.stringify({ jobs, lane, min_score: config?.minApplyScore ?? DEFAULT_CONFIG.minApplyScore }),
    });

    if (!matchRes.ok) {
      await recordCycle('scoring failed', `the app returned ${matchRes.status}`);
      return;
    }
    const matchData = await matchRes.json();

    const recommended = (matchData.matches || []).filter(m => m.should_apply);
    if (recommended.length === 0) {
      const best = Math.max(0, ...(matchData.matches || []).map(m => m.score || 0));
      await recordCycle('nothing cleared the bar', `${jobs.length} new, best score ${best}`);
      return;
    }

    await updateStats({ scanned: jobs.length, matched: matchData.matches?.length || 0 });

    // Step 3: Check for already-applied jobs
    const { appliedUrls = [] } = await chrome.storage.local.get('appliedUrls');
    const appliedSet = new Set(appliedUrls);
    const perCycle = config?.maxAppliesPerCycle || 5;
    const minScore = config?.minApplyScore ?? DEFAULT_CONFIG.minApplyScore;

    // Best match first, then take only what today's points actually cover.
    const candidates = recommended
      .filter(j => !appliedSet.has(j.apply_url) && (j.score || 0) >= minScore)
      .sort((a, b) => (b.score || 0) - (a.score || 0));

    const toApply = [];
    let plannedAp = 0;
    for (const job of candidates) {
      if (toApply.length >= perCycle) break;
      const ap = job.apply_points || 1;
      const allowed = await budgetAllows(plannedAp + ap);
      if (!allowed.ok) {
        console.log('[JF] stopping this cycle:', allowed.reason);
        break;
      }
      plannedAp += ap;
      toApply.push(job);
    }

    if (toApply.length === 0) {
      await recordCycle('already applied', `${recommended.length} matched but all were applied to before`);
      return;
    }

    // Review mode: never send unattended. Tell the user; clicking the
    // notification prepares the applications for review.
    if (config?.reviewBeforeSend !== false) {
      await notifyMatchesForReview(toApply);
      return;
    }

    await recordCycle('applying', `${toApply.length} job(s), ${plannedAp} point(s)`);
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
// Chrome stops an idle MV3 service worker after ~30s, and waiting on a slow
// fetch (the AI writing step) counts as idle. Any extension API call resets
// the timer, so ping one every 20s while long work is running.
let keepAliveUsers = 0;
let keepAliveTimer = null;
function keepAwake() {
  keepAliveUsers++;
  if (!keepAliveTimer) {
    keepAliveTimer = setInterval(() => chrome.runtime.getPlatformInfo().catch(() => {}), 20000);
  }
  return () => {
    keepAliveUsers--;
    if (keepAliveUsers <= 0 && keepAliveTimer) {
      clearInterval(keepAliveTimer);
      keepAliveTimer = null;
      keepAliveUsers = 0;
    }
  };
}

// Progress of the current Apply-All run, saved so that if Chrome still kills
// the worker mid-run, the next wake-up can close the leftover tab and tell the
// user where it stopped.
async function saveRunState(state) {
  await chrome.storage.local.set({ applyRun: state });
}

async function clearRunState() {
  await chrome.storage.local.remove('applyRun');
}

async function recoverInterruptedRun() {
  const { applyRun } = await chrome.storage.local.get('applyRun');
  if (!applyRun) return;
  await clearRunState();
  for (const id of applyRun.tabIds || []) {
    await chrome.tabs.remove(id).catch(() => {});
  }
  const unsure = applyRun.current ? ` "${applyRun.current}" may not have been sent, please check it.` : '';
  chrome.notifications.create({
    type: 'basic',
    title: 'Auto-Apply Stopped Early',
    message: `Stopped after ${applyRun.done} of ${applyRun.total} jobs.${unsure} Run it again to continue.`,
    iconUrl: 'icons/icon128.png',
  });
}

// Review mode: fill each application in its own tab and leave it for the user
// to check and click Send. Nothing is sent from here.
const MAX_REVIEW_TABS = 10;
const REVIEW_NOTIFICATION_ID = 'jf-review-matches';

async function prepareForReview(jobs) {
  if (applyRunning) return { busy: true };
  applyRunning = true;
  const release = keepAwake();

  let ready = 0;
  let firstTab = null;
  try {
    const { appliedUrls = [] } = await chrome.storage.local.get('appliedUrls');
    const alreadyApplied = new Set(appliedUrls);
    const pending = jobs.filter(j => j.apply_url && !alreadyApplied.has(j.apply_url)).slice(0, MAX_REVIEW_TABS);

    for (const [index, job] of pending.entries()) {
      // Review tabs are meant to stay open, so none are listed for cleanup;
      // nothing is sent here, so there's no "may have been sent" job either.
      await saveRunState({ tabIds: [], total: pending.length, done: index, current: null });
      let tab;
      try {
        tab = await chrome.tabs.create({ url: 'about:blank', active: false });
        const result = await handleNavigateAndApply(job, tab.id);
        if (result?.pending_review) {
          ready++;
          firstTab ??= tab;
        } else if (!result?.manual_required) {
          // Sent (review was switched off meanwhile) or failed: don't leave it open
          setTimeout(() => chrome.tabs.remove(tab.id).catch(() => {}), result?.sent ? 5000 : 0);
        }
        // manual_required: keep the tab open, it shows what's needed
      } catch {
        if (tab) chrome.tabs.remove(tab.id).catch(() => {});
      }
    }
  } finally {
    applyRunning = false;
    release();
    await clearRunState();
  }

  if (firstTab) {
    await chrome.tabs.update(firstTab.id, { active: true }).catch(() => {});
    await chrome.windows.update(firstTab.windowId, { focused: true }).catch(() => {});
    chrome.notifications.create({
      type: 'basic',
      title: 'Ready to Review',
      message: `${ready} application${ready > 1 ? 's are' : ' is'} filled in and open in tabs. Check each one and click Send.`,
      iconUrl: 'icons/icon128.png',
    });
  }
  return { ready };
}

// Background cycle in review mode: announce new matches once each.
async function notifyMatchesForReview(jobs) {
  const { notifiedUrls = [] } = await chrome.storage.local.get('notifiedUrls');
  const seen = new Set(notifiedUrls);
  const fresh = jobs.filter(j => !seen.has(j.apply_url));
  if (fresh.length === 0) return;

  await chrome.storage.local.set({
    notifiedUrls: [...notifiedUrls, ...fresh.map(j => j.apply_url)].slice(-500),
    reviewQueue: fresh,
  });
  const titles = fresh.slice(0, 3).map(j => j.title).join(', ');
  chrome.notifications.create(REVIEW_NOTIFICATION_ID, {
    type: 'basic',
    title: `${fresh.length} new matching job${fresh.length > 1 ? 's' : ''}`,
    message: `${titles}${fresh.length > 3 ? '...' : ''}. Click to prepare them for review.`,
    iconUrl: 'icons/icon128.png',
    requireInteraction: true,
  });
}

chrome.notifications.onClicked.addListener(async (id) => {
  if (id !== REVIEW_NOTIFICATION_ID) return;
  chrome.notifications.clear(id);
  const { reviewQueue = [] } = await chrome.storage.local.get('reviewQueue');
  await chrome.storage.local.remove('reviewQueue');
  if (reviewQueue.length) await prepareForReview(reviewQueue);
});

async function applyToJobs(jobs) {
  if (applyRunning) return { busy: true, applied: 0 };
  applyRunning = true;
  const release = keepAwake();

  let appliedCount = 0;
  let plannedCount = 0; // declared out here: `pending` is scoped to the try
  const outcomes = [];
  let bgTab;
  try {
    const { appliedUrls = [] } = await chrome.storage.local.get('appliedUrls');
    const alreadyApplied = new Set(appliedUrls);
    const pending = jobs.filter(j => j.apply_url && !alreadyApplied.has(j.apply_url));
    plannedCount = pending.length;
    if (pending.length === 0) return { applied: 0 };

    bgTab = await chrome.tabs.create({ url: 'about:blank', active: false });

    for (const [index, job] of pending.entries()) {
      await saveRunState({ tabIds: [bgTab.id], total: pending.length, done: index, current: job.title });
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
          } catch {
            outcomes.push('no apply button');
            continue;
          }
        }

        if (clickResult?.already_applied) {
          await markApplied(job.apply_url);
          outcomes.push('already applied');
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
            outcomes.push('no reply after send');
            continue;
          }
        }

        if (fillResult?.manual_required) outcomes.push('needs manual steps');
        else if (fillResult?.success) outcomes.push('sent');
        else outcomes.push('fill failed: ' + (fillResult?.error || 'unknown'));

        if (fillResult?.manual_required) {
          chrome.notifications.create({
            type: 'basic',
            title: 'Manual Action Needed',
            message: `"${job.title}" requires: ${(fillResult.requirements || ['manual steps']).join(', ')}`,
            iconUrl: 'icons/icon128.png',
          });
        } else if (fillResult?.success) {
          appliedCount++;
          // Points are spent the moment it sends, so the ledger moves here.
          await recordSpend(job.apply_points || 1);
          // The apply page knows the true balance; trust it over our running total.
          // readApBalance() runs before the send button is clicked, so the page
          // shows the balance BEFORE this application. Subtract what we just
          // spent, or the figure is permanently one application stale.
          if (fillResult.ap_balance != null) {
            await recordApBalance(fillResult.ap_balance - (fillResult.ap_spent || job.apply_points || 1));
          }
          await handleSaveJob(job);
          await logApplication(job, fillResult.application);
        } else {
          // Content script reported a clean failure: allow a retry next time
          await unmarkApplied(job.apply_url);
        }

        await sleep(3000);
      } catch (err) {
        outcomes.push('error: ' + String(err).slice(0, 60));
        continue;
      }
    }
  } finally {
    // Say what happened to every job, not only the ones that worked. "3 planned,
    // 1 sent" with no reason for the other two is what made this hard to debug.
    const tally = outcomes.reduce((a, o) => { a[o] = (a[o] || 0) + 1; return a; }, {});
    const summary = Object.entries(tally).map(([k, n]) => n + ' ' + k).join(', ');
    await recordCycle('sent ' + appliedCount + ' of ' + plannedCount, summary || 'nothing attempted');
    applyRunning = false;
    release();
    await clearRunState();
    if (bgTab) { try { await chrome.tabs.remove(bgTab.id); } catch {} }
  }

  if (appliedCount > 0) {
    const b = await getBudget();
    const left = b.apBalance != null ? `, ${b.apBalance} Apply Points left` : '';
    chrome.notifications.create({
      type: 'basic',
      title: 'Auto-Apply Complete',
      message: `Applied to ${appliedCount} job${appliedCount > 1 ? 's' : ''} (${b.applied} today, ${b.apSpent} points spent${left})`,
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
    handleGenerateApplication(message.job, message.formFields, message.options).then(sendResponse);
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

  if (message.action === 'runCycleNow') {
    // The alarm's first fire is a full interval away and every extension reload
    // resets that clock, so waiting is not always an option.
    runAutoApplyCycle('manual').then(
      () => chrome.storage.local.get('lastCycle').then((r) => sendResponse(r.lastCycle || null)),
      (err) => sendResponse({ status: 'error', detail: String(err) })
    );
    return true;
  }

  if (message.action === 'getBudget') {
    (async () => {
      const b = await getBudget();
      const { config } = await chrome.storage.local.get('config');
      const lanes = (config && config.lanes && config.lanes.length) ? config.lanes : DEFAULT_CONFIG.lanes;
      const order = laneOrder(lanes);
      const stored = await chrome.storage.local.get('laneCursor');
      const cursor = stored.laneCursor || 0;
      const nextLane = order[cursor % order.length];
      const lastCycle = (await chrome.storage.local.get('lastCycle')).lastCycle || null;
      sendResponse({
        lastCycle,
        applied: b.applied,
        apSpent: b.apSpent,
        apBalance: b.apBalance,
        day: b.day,
        nextLane,
        dailyApBudget: config?.dailyApBudget ?? DEFAULT_CONFIG.dailyApBudget,
        maxAppliesPerDay: config?.maxAppliesPerDay ?? DEFAULT_CONFIG.maxAppliesPerDay,
      });
    })();
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

  if (message.action === 'scanMultiplePages') {
    const tabId = message.tabId || sender.tab?.id;
    handleScanMultiplePages(message.baseUrl, message.maxPages, tabId).then(sendResponse);
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
    // Runs in background tabs so the sender page can navigate or close without
    // killing the loop. Respond immediately; completion comes as a notification.
    if (applyRunning) {
      sendResponse({ busy: true });
      return false;
    }
    chrome.storage.local.get('config').then(({ config }) => {
      const jobs = message.jobs || [];
      if (config?.reviewBeforeSend !== false) {
        prepareForReview(jobs);
        sendResponse({ started: true, review: true, count: Math.min(jobs.length, MAX_REVIEW_TABS) });
      } else {
        applyToJobs(jobs);
        sendResponse({ started: true });
      }
    });
    return true;
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
      body: JSON.stringify({ jobs, profile: config?.profile || DEFAULT_CONFIG.profile, min_score: config?.minApplyScore ?? DEFAULT_CONFIG.minApplyScore }),
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

// options: { role, improve, avoid } for switching focus, "Make it better" and
// "Regenerate" (see /api/extension/generate-application).
async function handleGenerateApplication(job, formFields, options = {}) {
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
        role: options?.role,
        improve: options?.improve,
        avoid: options?.avoid,
      }),
    });

    if (res.status === 401) {
      return { error: 'Session expired. Please sign in again.' };
    }

    if (!res.ok) {
      const data = await res.json().catch(() => null);
      return { error: data?.error || `API error: ${res.status}` };
    }
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
      body: JSON.stringify({ jobs: allJobs, profile: config?.profile || {}, min_score: config?.minApplyScore ?? DEFAULT_CONFIG.minApplyScore }),
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

async function logApplication(job, application) {
  await updateStats({ applied: 1 });

  // Record what actually went out. Without this the message is lost the moment
  // it sends and the end-of-day report has nothing to show.
  try {
    const { config } = await chrome.storage.local.get('config');
    const apiUrl = config?.apiUrl || DEFAULT_CONFIG.apiUrl;
    await apiFetch(`${apiUrl}/api/extension/log-application`, {
      method: 'POST',
      body: JSON.stringify({
        title: job.title,
        company: job.company,
        apply_url: job.apply_url,
        lane: job.lane,
        role: job.role,
        score: job.score,
        apply_points: job.apply_points,
        posted_at: job.posted_at,
        subject: application?.subject || '',
        message: application?.cover_letter || application?.message || '',
      }),
    });
  } catch (err) {
    // A failed log must never stop the run or look like a failed application.
    console.error('[JF] could not record application:', err);
  }

  chrome.notifications.create({
    type: 'basic',
    title: 'Application Sent',
    message: `Applied to "${job.title}" at ${job.company}`,
    iconUrl: 'icons/icon128.png',
  });

  return { success: true };
}
