// Background service worker for Job Finder Auto-Apply extension

const DEFAULT_CONFIG = {
  apiUrl: 'http://localhost:3000',
  autoApply: false,
  scanInterval: 60,
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

// Get auth headers for API calls
async function getAuthHeaders() {
  const { authToken } = await chrome.storage.local.get('authToken');
  const headers = { 'Content-Type': 'application/json' };
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }
  return headers;
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
});

// Handle periodic scanning
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'autoScan') {
    if (!(await isAuthenticated())) return;

    const { config } = await chrome.storage.local.get('config');
    if (!config?.autoApply) return;

    const tabs = await chrome.tabs.query({ url: 'https://www.onlinejobs.ph/*' });
    if (tabs.length > 0) {
      chrome.tabs.sendMessage(tabs[0].id, { action: 'autoScan' });
    }
  }
});

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
      body: JSON.stringify({ jobs, profile: config?.profile || DEFAULT_CONFIG.profile }),
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
    const headers = await getAuthHeaders();
    const res = await fetch(`${apiUrl}/api/extension/generate-application`, {
      method: 'POST',
      headers,
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
