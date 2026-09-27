// Background service worker for Job Finder Auto-Apply extension

const DEFAULT_CONFIG = {
  apiUrl: 'https://jobs.dlvasolutions.com',
  autoApply: false,
  scanInterval: 10,
  // ON by default, and the code that reads it says so too
  // (`reviewBeforeSend !== false`). It was only ever missing from here, which
  // made the default send path look like the exceptional one.
  reviewBeforeSend: true,
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

// Both ledgers are read-modify-write over chrome.storage, and both now have
// more than one caller that can fire at once: a review tab being sent while the
// alarm cycle runs, two generations in flight together. Without a queue the
// second read sees the first's pre-write state and the first write is silently
// lost - money and counts alike, with nothing left to recover them from. Same
// one-at-a-time chain mergeConfig already uses for the config.
//
// Everything below that touches a ledger comes in two halves: an apply/read
// half that must ONLY ever run inside the queue, and a public wrapper that puts
// it there. Never await a public wrapper from inside another one: that waits on
// a link of the chain which cannot start until you have returned.
let ledgerWrite = Promise.resolve();
function queueLedger(work) {
  // Runs regardless of how the previous link settled. One rejection must not
  // stall every later write for the life of the service worker.
  const done = ledgerWrite.then(() => work(), () => work());
  ledgerWrite = done.then(() => {}, () => {});
  return done;
}

async function readBudget() {
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

function getBudget() {
  return queueLedger(readBudget);
}

// The apply page shows the real balance. That reading beats any estimate.
function recordApBalance(balance) {
  if (typeof balance !== 'number' || !isFinite(balance) || balance < 0) return Promise.resolve(null);
  return queueLedger(async () => {
    const b = await readBudget();
    b.apBalance = balance;
    await chrome.storage.local.set({ budget: b });
    return b;
  });
}

// Can we afford to send one more application worth `ap` points right now?
// `ignoreDaily` skips the self-imposed daily limits only. The real onlinejobs
// balance is never overridden: spending points he does not have is not a
// preference, it just fails.
async function budgetAllows(ap, opts) {
  const ignoreDaily = !!(opts && opts.ignoreDaily);
  const { config } = await chrome.storage.local.get('config');
  const maxApplies = config && config.maxAppliesPerDay != null ? config.maxAppliesPerDay : DEFAULT_CONFIG.maxAppliesPerDay;
  const apBudget = config && config.dailyApBudget != null ? config.dailyApBudget : DEFAULT_CONFIG.dailyApBudget;
  const reserve = config && config.apReserve != null ? config.apReserve : DEFAULT_CONFIG.apReserve;
  const b = await getBudget();

  if (!ignoreDaily && b.applied >= maxApplies) return { ok: false, reason: 'daily application cap reached (' + b.applied + '/' + maxApplies + ')' };
  if (!ignoreDaily && b.apSpent + ap > apBudget) return { ok: false, reason: 'daily Apply Point budget spent (' + b.apSpent + '/' + apBudget + ')' };
  if (b.apBalance != null && b.apBalance - ap < reserve) return { ok: false, reason: 'only ' + b.apBalance + ' Apply Point' + (b.apBalance === 1 ? '' : 's') + ' left on onlinejobs' };
  return { ok: true };
}

// How many Apply Points an application really spends. The content script's
// pointsToSpend() clamps to 1-2 and DEFAULTS TO 2, so booking `apply_points||1`
// under-counted every job the API did not price: the form was filled with 2 and
// the ledger recorded 1, which is one of the ways budgetAllows could wave
// through applications there were no points left for. `reported` is the number
// the page actually filled in, and it wins whenever we have it.
function apSpentFor(job, reported) {
  // What the page actually filled in wins whenever it is a usable number.
  const fromPage = parseInt(reported, 10);
  if (Number.isFinite(fromPage) && fromPage > 0) return Math.min(2, fromPage);
  // Otherwise mirror pointsToSpend() EXACTLY, `|| 2` included. That `||` is
  // load-bearing: a falsy 0 there means "the API did not price this job", so the
  // form fills 2. Reading 0 as a real zero and booking 1 is the same under-count
  // this function exists to end.
  return Math.max(1, Math.min(2, parseInt(job && job.apply_points, 10) || 2));
}
async function applySpend(ap) {
  const b = await readBudget();
  b.applied += 1;
  b.apSpent += ap;
  if (b.apBalance != null) b.apBalance = Math.max(0, b.apBalance - ap);
  await chrome.storage.local.set({ budget: b });
  return b;
}

function recordSpend(ap) {
  return queueLedger(() => applySpend(ap));
}

// --- API cost ledger --------------------------------------------------------
// Every application's message is written by the Anthropic API, and that is real
// money. It is booked HERE, at generation, because a message is paid for
// whether or not it is ever sent: review-before-send is the default, so most of
// a day's spend can sit in drafts he has not clicked Send on yet. Booking it at
// the send would have shown $0 while the credits drained, which is the exact
// surprise this ledger exists to prevent. The send only counts the application.
// Same day key as the Apply Points budget above: one day boundary for both.

// Anything the server sends is treated as missing until it proves to be a
// number. An older server has no cost field at all, and an error path can send
// a partial one; neither may be allowed to throw.
function costNum(value) {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : 0;
}

const EMPTY_COST = { usd: 0, calls: 0, in: 0, cacheRead: 0, cacheWrite: 0, out: 0 };

// The six numbers we keep, from whatever shape actually arrived.
function readCost(cost) {
  if (!cost || typeof cost !== 'object') return { ...EMPTY_COST };
  return {
    usd: costNum(cost.usd),
    calls: costNum(cost.calls),
    in: costNum(cost.in),
    cacheRead: costNum(cost.cacheRead),
    cacheWrite: costNum(cost.cacheWrite),
    out: costNum(cost.out),
  };
}

// Did a price actually arrive? Money spent with no figure attached is not the
// same thing as money not spent, and the two must never end up in one number:
// the first makes every total a floor, the second is just a quiet day. A cost
// object carrying a usable `usd` is priced even when that usd is 0 - a fully
// cached generation genuinely costs nothing, and that is a measurement, not a
// gap. Anything else (no cost field at all, or a usd that will not read as a
// number) means the spend is unknown and the day's total is an understatement.
function hasPrice(cost) {
  if (!cost || typeof cost !== 'object') return false;
  const n = typeof cost.usd === 'string' ? Number(cost.usd) : cost.usd;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0;
}

function addCost(a, b) {
  return {
    usd: costNum(a && a.usd) + costNum(b && b.usd),
    calls: costNum(a && a.calls) + costNum(b && b.calls),
    in: costNum(a && a.in) + costNum(b && b.in),
    cacheRead: costNum(a && a.cacheRead) + costNum(b && b.cacheRead),
    cacheWrite: costNum(a && a.cacheWrite) + costNum(b && b.cacheWrite),
    out: costNum(a && a.out) + costNum(b && b.out),
  };
}

async function readCostLedger() {
  const stored = (await chrome.storage.local.get('costLedger')).costLedger;
  const today = phtDayKey();
  if (!stored || stored.day !== today) {
    // Today's counters start again; the all-time totals carry across the day
    // boundary, which is the only place they live.
    const fresh = {
      day: today,
      generations: 0,
      applications: 0,
      ...EMPTY_COST,
      unpricedGenerations: 0,
      totalUsd: costNum(stored && stored.totalUsd),
      totalGenerations: costNum(stored && stored.totalGenerations),
      totalUnpricedGenerations: costNum(stored && stored.totalUnpricedGenerations),
      totalApplications: costNum(stored && stored.totalApplications),
    };
    await chrome.storage.local.set({ costLedger: fresh });
    return fresh;
  }
  return stored;
}

function getCostLedger() {
  return queueLedger(readCostLedger);
}

async function applyGeneration(cost) {
  const c = readCost(cost);
  // A generation the server never priced still happened and was still paid for.
  // It cannot be priced here without inventing a figure, so it is COUNTED here
  // instead: the popup then says the total is a floor rather than reporting an
  // understatement as if it were the number. Kept as its own field so a measured
  // total is never mixed with a guess - that is what would make this ledger
  // impossible to check against the server's own [spend] log.
  const unpriced = hasPrice(cost) ? 0 : 1;
  const l = await readCostLedger();
  const next = {
    ...l,
    ...addCost(l, c),
    generations: costNum(l.generations) + 1,
    unpricedGenerations: costNum(l.unpricedGenerations) + unpriced,
    totalUsd: costNum(l.totalUsd) + c.usd,
    totalGenerations: costNum(l.totalGenerations) + 1,
    totalUnpricedGenerations: costNum(l.totalUnpricedGenerations) + unpriced,
  };
  await chrome.storage.local.set({ costLedger: next });
  return next;
}

// Money is recorded the moment it is SPENT, not when an application is sent.
// Review-before-send is the default, so a message can be generated, paid for,
// and never sent: recording at the send would have shown $0 while the credits
// drained, which is the exact surprise this ledger exists to prevent. A
// regenerate ("Make it better") is another paid generation and counts as one.
function recordGeneration(cost) {
  return queueLedger(() => applyGeneration(cost));
}

async function applySentApplication() {
  const l = await readCostLedger();
  const next = {
    ...l,
    applications: costNum(l.applications) + 1,
    totalApplications: costNum(l.totalApplications) + 1,
  };
  await chrome.storage.local.set({ costLedger: next });
  return next;
}

// A send. The money was already counted when the message was written, so this
// only counts the application.
function recordSentApplication() {
  return queueLedger(applySentApplication);
}

// Every successful send converges here, and it must be safe to call twice for
// the same application. There are two send paths and the one that was never
// booking anything is the DEFAULT one:
//   - auto-send: applyToJobs clicks Send itself and calls this directly;
//   - review (the default, since reviewBeforeSend defaults to true): the content
//     script clicks Send and messages 'logApply', which lands here too.
// Until this existed only the first path booked anything, so by default the
// popup read "0 sent" forever while the Applied tile above it climbed, and - far
// worse - not a single Apply Point was recorded, so budgetAllows would authorise
// ten more applications after the day's ten were already gone.
//
// Booked once per apply_url: an application is sent once, and both paths can
// fire for the same job. A job with no apply_url cannot be de-duplicated and is
// booked every time, which is the right way round - losing a real spend is worse
// than counting a freak one twice.
const BOOKED_SENDS_CAP = 500;

function bookSentApplication(job, reportedAp) {
  return queueLedger(async () => {
    const url = job && job.apply_url;
    const { bookedSends = [] } = await chrome.storage.local.get('bookedSends');
    if (url && bookedSends.includes(url)) return { booked: false, ap: 0 };
    const ap = apSpentFor(job, reportedAp);
    await applySpend(ap);
    await applySentApplication();
    if (url) {
      await chrome.storage.local.set({ bookedSends: [...bookedSends, url].slice(-BOOKED_SENDS_CAP) });
    }
    return { booked: true, ap };
  });
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
  return jobs.filter((j) => j.apply_url && !seen.has(j.apply_url));
}

// Marking happens only AFTER a job has been judged, and only for jobs we will
// never want to revisit: ones that scored below the bar, and ones we applied
// to. Marking everything on sight burned the whole page on the first cycle,
// including jobs that qualified but did not fit in that cycle's limit, so a
// backlog of good matches was silently thrown away and every later cycle said
// "nothing new".
async function markSeen(urls) {
  if (!urls || urls.length === 0) return;
  const stored = await chrome.storage.local.get('seenUrls');
  const seen = new Set(stored.seenUrls || []);
  for (const u of urls) if (u) seen.add(u);
  await chrome.storage.local.set({ seenUrls: [...seen].slice(-4000) });
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
const NEWLINE = String.fromCharCode(10);

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

async function runAutoApplyCycle(trigger, opts) {
  const ignoreDaily = !!(opts && opts.ignoreDaily);
  {
    if (!(await isAuthenticated())) {
      await recordCycle('Not signed in', 'Sign in from the extension popup.');
      return;
    }

    const { config } = await chrome.storage.local.get('config');
    if (!config?.autoApply) {
      await recordCycle('Auto-apply is off', 'Turn on Auto-Apply Mode.');
      return;
    }

    // Nothing to do if today's budget is already spent: don't even open a tab.
    const spare = await budgetAllows(1, { ignoreDaily });
    if (!spare.ok) {
      await recordCycle('Budget stopped it', spare.reason);
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
    await recordCycle('Searching', 'Looking for "' + search + '" jobs.');
    const tab = await chrome.tabs.create({ url: searchUrl, active: false });

    await waitForTabLoad(tab.id);
    await sleep(3000); // Let JS render

    // With no lanes ticked the search comes from the keyword box, so there is
    // no lane to score against: let the API judge each job against all four.
    await handleAutoApplyCycle(tab.id, useLanes ? lane : null, { ignoreDaily });

    // Close the search tab after scanning
    try { await chrome.tabs.remove(tab.id); } catch {}
  }
}

// Full auto-apply cycle: scan page, match jobs, apply to recommended ones
async function handleAutoApplyCycle(tabId, lane, opts) {
  const ignoreDaily = !!(opts && opts.ignoreDaily);
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
        await recordCycle('Could not read the page', 'The search page did not respond.');
        return;
      }
    }

    const allJobs = scrapeResult?.jobs || [];
    if (allJobs.length === 0) {
      await recordCycle('No jobs on the page', 'That search returned nothing.');
      return;
    }

    // Only look at posts we have not already scored in an earlier cycle, and
    // only while they are still fresh enough to be worth a point.
    const maxAge = config?.maxJobAgeHours ?? DEFAULT_CONFIG.maxJobAgeHours;
    const unseen = await filterUnseen(allJobs);
    const jobs = filterFresh(unseen, maxAge);
    if (jobs.length === 0) {
      await recordCycle('Nothing new', `${allJobs.length} on the page, all already seen or older than ${maxAge}h. Try "Re-check older posts".`);
      return;
    }

    // Step 2: Match jobs
    const apiUrl = config?.apiUrl || 'https://jobs.dlvasolutions.com';
    const matchRes = await apiFetch(`${apiUrl}/api/extension/match-jobs`, {
      method: 'POST',
      body: JSON.stringify({ jobs, lane, min_score: config?.minApplyScore ?? DEFAULT_CONFIG.minApplyScore }),
    });

    if (!matchRes.ok) {
      await recordCycle('Scoring failed', `The app returned ${matchRes.status}.`);
      return;
    }
    const matchData = await matchRes.json();

    // Everything scored below the bar has been judged: never look at it again.
    const belowBar = (matchData.matches || []).filter(m => !m.should_apply).map(m => m.apply_url);
    await markSeen(belowBar);

    // Jobs the post itself ruled out ("do not apply unless you have X"). Worth
    // naming: a high score that was skipped on purpose looks like a bug.
    const blocked = (matchData.matches || []).filter(m => m.blocked_by && m.blocked_by.length);
    if (blocked.length) {
      console.log('[JF] blocked by the post itself:', blocked.map(b => `${b.title} needs ${b.blocked_by.join('/')}`).join(' | '));
    }

    const recommended = (matchData.matches || []).filter(m => m.should_apply);
    if (recommended.length === 0) {
      const best = Math.max(0, ...(matchData.matches || []).map(m => m.score || 0));
      const note = blocked.length ? `, ${blocked.length} ruled out by the post (${blocked[0].blocked_by.join('/')})` : '';
      await recordCycle('Nothing cleared the bar', `${jobs.length} new, best score ${best}${note}.`);
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
      const allowed = await budgetAllows(plannedAp + ap, { ignoreDaily });
      if (!allowed.ok) {
        console.log('[JF] stopping this cycle:', allowed.reason);
        break;
      }
      plannedAp += ap;
      toApply.push(job);
    }

    if (toApply.length === 0) {
      await recordCycle('Already applied to all of them', `${recommended.length} matched, every one applied to before.`);
      return;
    }

    // Review mode: never send unattended. Tell the user; clicking the
    // notification prepares the applications for review.
    if (config?.reviewBeforeSend !== false) {
      await notifyMatchesForReview(toApply);
      return;
    }

    // Only the ones actually being applied to are marked. Qualifying jobs that
    // did not fit this cycle stay eligible and get picked up next time.
    await markSeen(toApply.map(j => j.apply_url));
    await recordCycle('Applying', `${toApply.length} job(s), ${plannedAp} point(s)` +
      (blocked.length ? `, ${blocked.length} ruled out by the post` : ''));
    await applyToJobs(toApply);
  } catch {
    // Silent fail for background cycle
  }
}

// Guards against the alarm cycle and "Apply to All" running at the same time
let applyRunning = false;

// The local re-apply guard. Every reader of appliedUrls (applyToJobs,
// prepareForReview, the scoring cycle) skips what is in here, so a lost write
// means a second application to the same post: 1-2 Apply Points spent for
// nothing, and a second message in an inbox that already has one, which reads
// worse than not applying at all. Queued for the same reason the ledgers are -
// several review tabs can report their sends at once.
function markApplied(url) {
  if (!url) return Promise.resolve();
  return queueLedger(async () => {
    const { appliedUrls = [] } = await chrome.storage.local.get('appliedUrls');
    if (!appliedUrls.includes(url)) {
      appliedUrls.push(url);
      await chrome.storage.local.set({ appliedUrls });
    }
  });
}

function unmarkApplied(url) {
  if (!url) return Promise.resolve();
  return queueLedger(async () => {
    const { appliedUrls = [] } = await chrome.storage.local.get('appliedUrls');
    await chrome.storage.local.set({ appliedUrls: appliedUrls.filter(u => u !== url) });
  });
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
          // The page states the real balance and nothing has been sent yet, so
          // this reading is current and goes in as-is - no subtraction. The send
          // that follows decrements it through bookSentApplication. Without this
          // the Today card said "not read yet" indefinitely on the default path.
          if (result.ap_balance != null) await recordApBalance(result.ap_balance);
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
        await waitForContentScript(bgTab.id, (r) => r.ready);

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
          await waitForContentScript(bgTab.id, (r) => r.fields > 0 && r.hasTextarea);
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
          // A Chrome notification vanishes and the job is then lost. Jobs that
          // ask for a Loom, a test or a form are often the serious postings, so
          // keep them somewhere he can come back to.
          await queueManual(job, fillResult.requirements, fillResult.application);
          chrome.notifications.create({
            type: 'basic',
            title: 'Needs you: ' + job.title.slice(0, 40),
            message: `${(fillResult.requirements || ['manual steps']).join(', ')}
The message is drafted and waiting in the popup.`,
            iconUrl: 'icons/icon128.png',
          });
        } else if (fillResult?.success) {
          appliedCount++;
          // Points and the sent count, booked once per application. The money for
          // the message was already booked when it was written, whether or not
          // it ever reached this line. `ap_spent` is what the page was actually
          // filled with, which beats anything inferred from the job.
          await bookSentApplication(job, fillResult.ap_spent);
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
    await recordCycle('Sent ' + appliedCount + ' of ' + plannedCount, summary || 'Nothing attempted.');
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
    // sendResponse fires once, so progress goes back to the tab as its own
    // messages while the request is still in flight.
    const tabId = sender?.tab?.id;
    const onProgress = typeof tabId === 'number'
      ? (phase) => { chrome.tabs.sendMessage(tabId, { action: 'generateProgress', phase }).catch(() => {}); }
      : undefined;
    handleGenerateApplication(message.job, message.formFields, message.options, onProgress).then(sendResponse);
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
    //
    // The outcome also goes out as a notification. Opening the search tab can
    // close the popup, and once that happens its script is gone and the reply
    // below reaches nobody: the run looks like it did nothing at all.
    runAutoApplyCycle('manual', { ignoreDaily: !!message.ignoreDaily }).then(
      async () => {
        const { lastCycle } = await chrome.storage.local.get('lastCycle');
        if (lastCycle) {
          chrome.notifications.create({
            type: 'basic',
            title: 'Cycle finished: ' + lastCycle.status,
            message: lastCycle.detail || 'No further detail.',
            iconUrl: 'icons/icon128.png',
          });
        }
        try { sendResponse(lastCycle || null); } catch { /* popup already closed */ }
      },
      (err) => {
        chrome.notifications.create({
          type: 'basic',
          title: 'Cycle failed',
          message: String(err).slice(0, 180),
          iconUrl: 'icons/icon128.png',
        });
        try { sendResponse({ status: 'error', detail: String(err) }); } catch {}
      }
    );
    return true;
  }

  if (message.action === 'clearSeen') {
    // Jobs already applied to stay protected by appliedUrls, so clearing this
    // only makes older posts eligible to be scored again. Report the count:
    // an action with no visible effect looks like a broken button.
    (async () => {
      const { seenUrls = [] } = await chrome.storage.local.get('seenUrls');
      await chrome.storage.local.remove('seenUrls');
      sendResponse({ ok: true, cleared: seenUrls.length });
    })();
    return true;
  }

  if (message.action === 'getTodayApplications') {
    (async () => {
      try {
        const { config } = await chrome.storage.local.get('config');
        const apiUrl = config?.apiUrl || DEFAULT_CONFIG.apiUrl;
        const res = await apiFetch(`${apiUrl}/api/extension/applications`);
        if (!res.ok) { sendResponse({ applications: [], error: 'HTTP ' + res.status }); return; }
        sendResponse(await res.json());
      } catch (err) {
        sendResponse({ applications: [], error: String(err) });
      }
    })();
    return true;
  }

  if (message.action === 'getManualQueue') {
    chrome.storage.local.get('manualQueue').then((r) => sendResponse(r.manualQueue || []));
    return true;
  }

  if (message.action === 'clearManualJob') {
    chrome.storage.local.get('manualQueue').then(({ manualQueue = [] }) =>
      chrome.storage.local
        .set({ manualQueue: manualQueue.filter((m) => m.apply_url !== message.apply_url) })
        .then(() => sendResponse({ ok: true }))
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
      const cost = await getCostLedger();
      sendResponse({
        lastCycle,
        // Every field normalised here, so a ledger written by an older version
        // cannot hand the popup an undefined to render.
        cost: {
          ...addCost(cost, EMPTY_COST),
          generations: costNum(cost.generations),
          unpricedGenerations: costNum(cost.unpricedGenerations),
          applications: costNum(cost.applications),
          totalUsd: costNum(cost.totalUsd),
          totalGenerations: costNum(cost.totalGenerations),
          totalUnpricedGenerations: costNum(cost.totalUnpricedGenerations),
          totalApplications: costNum(cost.totalApplications),
        },
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
    chrome.storage.local.get('stats').then(({ stats }) => sendResponse(stats || { scanned: 0, matched: 0, applied: 0, today: phtDayKey() }));
    return true;
  }

  if (message.action === 'logApply') {
    // The review path clicks Send in the page and reports it here, and this is
    // the only place it tells us. Booking the points and the sent count here is
    // what stops the default path recording nothing at all; bookSentApplication
    // is idempotent per apply_url, so a job that also went through applyToJobs
    // is still counted exactly once.
    (async () => {
      // Mark it applied here too, not only book it. applyToJobs has always marked
      // (before it clicks Send), but the review path never did, so nothing stopped
      // a second application to the same post - an oversight, not a decision. He
      // holds around 60 Apply Points and earns 10 a day, so a duplicate is a real
      // loss twice over: the points, and a second message to an employer who
      // already has one.
      await markApplied(message.job && message.job.apply_url);
      await bookSentApplication(message.job, message.ap_spent);
      sendResponse(await logApplication(message.job));
    })();
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
async function handleGenerateApplication(job, formFields, options = {}, onProgress) {
  if (!(await isAuthenticated())) {
    return { error: 'Not logged in' };
  }

  const { config } = await chrome.storage.local.get('config');
  const apiUrl = config?.apiUrl || DEFAULT_CONFIG.apiUrl;

  // Hoisted out of the try so the catch below can still book a stream that died
  // after the server had already paid for the model calls. `booked` makes the
  // booking once-only: every exit from here goes through book(), and a throw on
  // the way out must not charge the same generation a second time.
  let streamCost = null;
  let booked = false;
  const book = async (cost) => {
    if (booked) return;
    booked = true;
    await recordGeneration(cost);
  };

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
        // Ask for phase-by-phase progress. Only honoured when a caller wants
        // it; the server still answers plain JSON for everyone else.
        stream: !!onProgress,
      }),
    });

    if (res.status === 401) {
      return { error: 'Session expired. Please sign in again.' };
    }

    if (!res.ok) {
      const data = await res.json().catch(() => null);
      // A 500 out of the writing step is not free: the guard that rejects a bad
      // draft throws after the model has already been paid for three or four
      // calls, and the server reports that on the error body. Book it, or the
      // money is gone with nothing on screen to account for it.
      //
      // Only when a cost actually arrived. No cost field means nothing is known
      // to have been spent (a 400, a rejected request), and booking a zero-cost
      // generation there would pad the message count and flatten the average
      // with a call that never reached the model.
      if (data && data.cost) await book(data.cost);
      return { error: data?.error || `API error: ${res.status}` };
    }
    // NDJSON: progress lines first, then one final line carrying the result.
    // If anything about the stream misbehaves we fall through to the last line
    // we parsed, so a buffered proxy costs the progress text and nothing else.
    if (onProgress && res.body && (res.headers.get('content-type') || '').includes('ndjson')) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let result = null;
      const consume = (chunk) => {
        buffer += chunk;
        let cut = buffer.indexOf(NEWLINE);
        while (cut !== -1) {
          const raw = buffer.slice(0, cut).trim();
          buffer = buffer.slice(cut + 1);
          if (raw) {
            try {
              const msg = JSON.parse(raw);
              if (msg.type === 'progress') onProgress(msg.phase);
              else if (msg.type === 'result') result = msg.result;
              // Any line may carry what has been spent so far, including the
              // server's error line. Kept as the LAST one seen rather than a
              // running sum, because each line reports the generation's total
              // and adding them would multiply the bill.
              if (msg && msg.cost) streamCost = msg.cost;
            } catch { /* a partial or malformed line is not worth failing over */ }
          }
          cut = buffer.indexOf(NEWLINE);
        }
      };
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        consume(decoder.decode(value, { stream: true }));
      }
      consume(decoder.decode());
      // A stream can end without its trailing newline, leaving one whole line
      // sitting in the buffer. This used to be `consume(buffer + NEWLINE)`,
      // which appended the buffer to ITSELF and produced `{...}{...}` - which
      // fails JSON.parse, is swallowed by the catch above, and loses a result
      // the API had already been paid in full for, reporting $0.00 and "No
      // application came back". consume() only ever needed the newline it is
      // waiting for.
      if (buffer.trim()) consume(NEWLINE);
      // Unconditional: if the stream died before its result line, the model
      // calls behind it were still billed. The server reports cost on its error
      // line too, so a failed generate books what it actually spent rather than
      // hiding it. A truncated stream with no line at all books zero, which is
      // the one gap left and is better than pretending the call was free.
      await book((result && result.cost) || streamCost);
      return result || { error: 'No application came back' };
    }

    const data = await res.json();
    await book(data.cost);
    return data;
  } catch (err) {
    // The stream can fail mid-read after the server has been paid in full. Book
    // whatever a line already told us; `book` is once-only, so a throw AFTER the
    // normal booking cannot pay for the same generation twice. Nothing is booked
    // when no line ever arrived: a connection that failed before the server
    // answered cost nothing, and a phantom generation would only flatten the
    // average and pad the message count.
    if (streamCost) await book(streamCost);
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
  // phtDayKey, the same boundary both ledgers use. This was the machine's own
  // toDateString(), so the tiles rolled over at local midnight while the Spending
  // line and the Apply Points rolled over at Philippine midnight - two numbers on
  // one screen disagreeing for part of every day, and the machine's timezone was
  // the thing that decided how big the gap was.
  const today = phtDayKey();
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
    await waitForContentScript(tabId, (r) => r.ready);

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
      await waitForContentScript(tabId, (r) => r.fields > 0 && r.hasTextarea);
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
    let settled = false;
    function finish() {
      if (settled) return;
      settled = true;
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }
    function listener(updatedTabId, changeInfo) {
      if (updatedTabId === tabId && changeInfo.status === 'complete') finish();
    }
    chrome.tabs.onUpdated.addListener(listener);
    // The listener attaches only after tabs.update() has been awaited, so a
    // fast load can fire 'complete' before we are listening and the event is
    // gone for good. Without this check that case waited the full 15s.
    chrome.tabs.get(tabId).then((tab) => {
      if (tab && tab.status === 'complete') finish();
    }).catch(() => {});
    setTimeout(finish, 15000);
  });
}

// Poll the content script rather than sleeping a fixed amount.
// waitForTabLoad registers its onUpdated listener AFTER tabs.update() was
// already awaited, so a fast load can fire 'complete' before the listener
// attaches and the promise then sits for the full 15s cap. Asking the content
// script directly is both faster and a stronger signal: it proves the script is
// injected and can report whether the form is actually usable yet.
async function waitForContentScript(tabId, isReady, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    try {
      const reply = await chrome.tabs.sendMessage(tabId, { action: 'ping' });
      if (reply) {
        last = reply;
        if (!isReady || isReady(reply)) return reply;
      }
    } catch (e) {
      // No content script on this document yet; keep polling until the deadline.
    }
    await sleep(100);
  }
  return last;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Jobs the automation could not finish: a Loom video, a skills test, an
// external form. Kept locally so the popup can list them, and recorded server
// side so the end-of-day report can too.
async function queueManual(job, requirements, application) {
  const { manualQueue = [] } = await chrome.storage.local.get('manualQueue');
  if (!manualQueue.some((m) => m.apply_url === job.apply_url)) {
    manualQueue.unshift({
      title: job.title,
      company: job.company || '',
      apply_url: job.apply_url,
      lane: job.lane || '',
      score: job.score || null,
      requirements: requirements || ['manual steps'],
      // The message is written even though it cannot be sent automatically: he
      // records the video himself and sends by hand, and the draft is most of
      // that work already done.
      subject: (application && application.subject) || '',
      message: (application && (application.cover_letter || application.message)) || '',
      at: new Date().toISOString(),
    });
    await chrome.storage.local.set({ manualQueue: manualQueue.slice(0, 50) });
  }

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
        apply_points: 0,
        status: 'needs_manual',
        subject: (application && application.subject)
          || ('Needs you: ' + (requirements || ['manual steps']).join(', ')),
        message: (application && (application.cover_letter || application.message)) || '',
        posted_at: job.posted_at,
      }),
    });
  } catch (err) {
    console.error('[JF] could not record a manual job:', err);
  }
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
        status: 'sent',
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
