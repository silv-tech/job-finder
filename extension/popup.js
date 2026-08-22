// Popup script for Job Finder extension

document.addEventListener('DOMContentLoaded', async () => {
  const loadingView = document.getElementById('loading-view');
  const loginView = document.getElementById('login-view');
  const mainView = document.getElementById('main-view');

  // Auto-show login if loading takes too long
  const loadingTimeout = setTimeout(() => {
    loadingView.classList.add('hidden');
    showLoginView();
  }, 10000);

  // Check if already logged in
  const { authToken, userEmail } = await chrome.storage.local.get(['authToken', 'userEmail']);

  if (authToken) {
    // Verify token is still valid
    const config = await chrome.runtime.sendMessage({ action: 'getConfig' });
    const apiUrl = config?.apiUrl || 'https://jobs.dlvasolutions.com';

    try {
      const res = await fetch(`${apiUrl}/api/auth/session`, {
        headers: { 'Authorization': `Bearer ${authToken}` },
      });
      if (res.ok) {
        clearTimeout(loadingTimeout);
        loadingView.classList.add('hidden');
        showMainView(userEmail || 'User', config);
        return;
      }
    } catch {}

    // Token invalid — clear and show login
    await chrome.storage.local.remove(['authToken', 'userEmail', 'authRefreshToken']);
  }

  clearTimeout(loadingTimeout);
  loadingView.classList.add('hidden');
  showLoginView();

  // === LOGIN ===
  function showLoginView() {
    loginView.classList.remove('hidden');
    mainView.classList.add('hidden');

    document.getElementById('login-btn').addEventListener('click', handleLogin);
    document.getElementById('login-password').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleLogin();
    });

    document.getElementById('signup-link-btn').addEventListener('click', () => {
      const config = chrome.runtime.sendMessage({ action: 'getConfig' });
      config.then((c) => {
        chrome.tabs.create({ url: (c?.apiUrl || 'https://jobs.dlvasolutions.com') });
      });
    });
  }

  async function handleLogin() {
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const errorEl = document.getElementById('login-error');
    const btn = document.getElementById('login-btn');

    if (!email || !password) {
      errorEl.textContent = 'Enter your email and password';
      errorEl.classList.remove('hidden');
      return;
    }

    btn.textContent = 'Signing in...';
    btn.disabled = true;
    errorEl.classList.add('hidden');

    try {
      const config = await chrome.runtime.sendMessage({ action: 'getConfig' });
      const apiUrl = config?.apiUrl || 'https://jobs.dlvasolutions.com';

      // Sign in via Supabase REST API directly
      const supabaseUrl = await getSupabaseUrl(apiUrl);
      if (!supabaseUrl) {
        throw new Error('Could not connect to the app. Make sure it\'s running.');
      }

      const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': await getSupabaseAnonKey(apiUrl),
        },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (!res.ok || !data.access_token) {
        throw new Error(data.error_description || data.msg || 'Invalid email or password');
      }

      // Store tokens
      await chrome.storage.local.set({
        authToken: data.access_token,
        authRefreshToken: data.refresh_token,
        userEmail: data.user?.email || email,
      });

      // Switch to main view
      const updatedConfig = await chrome.runtime.sendMessage({ action: 'getConfig' });
      showMainView(data.user?.email || email, updatedConfig);
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.classList.remove('hidden');
    } finally {
      btn.textContent = 'Sign In';
      btn.disabled = false;
    }
  }

  // Get Supabase URL from the app's env (exposed via a simple endpoint)
  async function getSupabaseUrl(apiUrl) {
    try {
      // Try to get it from the app's config
      const res = await fetch(`${apiUrl}/api/auth/supabase-config`);
      if (res.ok) {
        const data = await res.json();
        return data.url;
      }
    } catch {}
    return null;
  }

  async function getSupabaseAnonKey(apiUrl) {
    try {
      const res = await fetch(`${apiUrl}/api/auth/supabase-config`);
      if (res.ok) {
        const data = await res.json();
        return data.anonKey;
      }
    } catch {}
    return '';
  }

  // === MAIN VIEW ===
  function showMainView(email, config) {
    loginView.classList.add('hidden');
    mainView.classList.remove('hidden');

    document.getElementById('user-email').textContent = email;

    // Load stats
    chrome.runtime.sendMessage({ action: 'getStats' }).then((stats) => {
      document.getElementById('stat-scanned').textContent = stats?.scanned || 0;
      document.getElementById('stat-matched').textContent = stats?.matched || 0;
      document.getElementById('stat-applied').textContent = stats?.applied || 0;
    });

    // Populate settings
    document.getElementById('review-toggle').checked = config?.reviewBeforeSend !== false;
    document.getElementById('auto-apply-toggle').checked = config?.autoApply || false;
    document.getElementById('scan-interval-visible').value = config?.scanInterval || 60;
    document.getElementById('max-applies').value = config?.maxAppliesPerCycle || 5;
    document.getElementById('min-score').value = config?.minApplyScore || 40;

    // Show/hide auto-apply config
    if (config?.autoApply) {
      document.getElementById('auto-apply-config').classList.remove('hidden');
    }
    document.getElementById('api-url').value = config?.apiUrl || 'https://jobs.dlvasolutions.com';
    document.getElementById('scan-interval').value = config?.scanInterval || 60;

    // Auto-save toggles when changed
    document.getElementById('review-toggle').addEventListener('change', () => saveSettings(config));
    document.getElementById('auto-apply-toggle').addEventListener('change', () => {
      const isOn = document.getElementById('auto-apply-toggle').checked;
      document.getElementById('auto-apply-config').classList.toggle('hidden', !isOn);
      saveSettings(config);
    });
    document.getElementById('scan-interval-visible').addEventListener('change', () => saveSettings(config));
    document.getElementById('max-applies').addEventListener('change', () => saveSettings(config));
    document.getElementById('min-score').addEventListener('change', () => saveSettings(config));

    function saveSettings(baseConfig) {
      const scanInterval = Math.max(5, Math.min(1440, parseInt(document.getElementById('scan-interval-visible').value) || 60));
      const updatedConfig = {
        ...baseConfig,
        reviewBeforeSend: document.getElementById('review-toggle').checked,
        autoApply: document.getElementById('auto-apply-toggle').checked,
        apiUrl: document.getElementById('api-url').value.replace(/\/$/, ''),
        scanInterval,
        maxAppliesPerCycle: Math.max(1, Math.min(20, parseInt(document.getElementById('max-applies').value) || 5)),
        minApplyScore: Math.max(10, Math.min(100, parseInt(document.getElementById('min-score').value) || 40)),
      };
      // Update the hidden scan-interval too
      document.getElementById('scan-interval').value = scanInterval;
      // Update alarm with new interval
      chrome.alarms.create('autoScan', { periodInMinutes: scanInterval });
      chrome.runtime.sendMessage({ action: 'updateConfig', config: updatedConfig });
    }

    // Check connection
    checkConnection(config?.apiUrl || 'https://jobs.dlvasolutions.com');

    // Check if there are saved results to show
    chrome.storage.local.get(['lastScanResults', 'lastScanTime']).then(({ lastScanResults, lastScanTime }) => {
      if (lastScanResults && lastScanResults.length > 0) {
        const showBtn = document.getElementById('show-results-btn');
        const ago = lastScanTime ? Math.round((Date.now() - lastScanTime) / 60000) : 0;
        const timeText = ago < 1 ? 'just now' : ago < 60 ? `${ago}m ago` : `${Math.round(ago/60)}h ago`;
        showBtn.textContent = `Show Last Results (${lastScanResults.length} matches, ${timeText})`;
        showBtn.classList.remove('hidden');
      }
    });

    // Show last results button
    document.getElementById('show-results-btn').addEventListener('click', async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab.url?.includes('onlinejobs.ph')) {
          await chrome.tabs.sendMessage(tab.id, { action: 'showLastResults' });
        } else {
          const resultEl = document.getElementById('scan-result');
          resultEl.textContent = 'Navigate to onlinejobs.ph to see results.';
          resultEl.className = 'scan-error';
        }
      } catch {}
    });

    // Job search input - opens OLJ with search query and auto-scans
    document.getElementById('job-search-input').addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter') return;
      const query = e.target.value.trim();
      if (!query) return;

      const searchUrl = `https://www.onlinejobs.ph/jobseekers/jobsearch?jobkeyword=${encodeURIComponent(query)}&gig=on&partTime=on&fullTime=on&isFromJobsearchForm=1`;
      const tab = await chrome.tabs.create({ url: searchUrl });
      e.target.value = '';

      // Tell background to auto-scan once the tab loads
      chrome.runtime.sendMessage({ action: 'autoScanWhenReady', tabId: tab.id });
    });

    // Scan button
    document.getElementById('scan-btn').addEventListener('click', async () => {
      const btn = document.getElementById('scan-btn');
      const resultEl = document.getElementById('scan-result');

      btn.textContent = 'Scanning...';
      btn.disabled = true;

      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        if (!tab.url?.includes('onlinejobs.ph')) {
          resultEl.textContent = 'Navigate to onlinejobs.ph first, then scan.';
          resultEl.className = 'scan-error';
          btn.textContent = 'Scan Current Page';
          btn.disabled = false;
          return;
        }

        const result = await chrome.tabs.sendMessage(tab.id, { action: 'scanJobs' });

        if (result?.error) {
          resultEl.textContent = result.error;
          resultEl.className = 'scan-error';
        } else {
          resultEl.textContent = `Found ${result?.jobs || 0} jobs, ${result?.matches || 0} matches`;
          resultEl.className = 'scan-success';

          const newStats = await chrome.runtime.sendMessage({ action: 'getStats' });
          document.getElementById('stat-scanned').textContent = newStats?.scanned || 0;
          document.getElementById('stat-matched').textContent = newStats?.matched || 0;
        }
      } catch (err) {
        resultEl.textContent = 'Error: ' + err.message;
        resultEl.className = 'scan-error';
      }

      btn.textContent = 'Scan Current Page';
      btn.disabled = false;
    });

    // Scan all pages button — talks directly to background script
    document.getElementById('scan-all-btn').addEventListener('click', async () => {
      const btn = document.getElementById('scan-all-btn');
      const resultEl = document.getElementById('scan-result');

      btn.textContent = 'Scanning pages...';
      btn.disabled = true;

      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        if (!tab.url?.includes('onlinejobs.ph')) {
          resultEl.textContent = 'Navigate to onlinejobs.ph first, then scan.';
          resultEl.className = 'scan-error';
          btn.textContent = 'Scan All Pages (1-3)';
          btn.disabled = false;
          return;
        }

        // Send directly to background script, not content script
        const result = await chrome.runtime.sendMessage({
          action: 'scanMultiplePages',
          maxPages: 3,
          baseUrl: tab.url,
          tabId: tab.id,
        });

        if (result?.error) {
          resultEl.textContent = result.error;
          resultEl.className = 'scan-error';
        } else {
          const breakdown = (result?.pageBreakdown || []).map(p => `P${p.page}:${p.count}`).join(' ');
          resultEl.textContent = `${result?.totalJobs || 0} jobs from ${result?.pageBreakdown?.length || 0} pages (${breakdown}), ${result?.matches?.length || 0} matches`;
          resultEl.className = 'scan-success';

          const newStats = await chrome.runtime.sendMessage({ action: 'getStats' });
          document.getElementById('stat-scanned').textContent = newStats?.scanned || 0;
          document.getElementById('stat-matched').textContent = newStats?.matched || 0;
        }
      } catch (err) {
        resultEl.textContent = 'Error: ' + err.message;
        resultEl.className = 'scan-error';
      }

      btn.textContent = 'Scan All Pages (1-3)';
      btn.disabled = false;
    });

    // Open app
    document.getElementById('open-app-btn').addEventListener('click', () => {
      chrome.tabs.create({ url: 'https://jobs.dlvasolutions.com' });
    });

    // Save settings
    document.getElementById('save-settings-btn').addEventListener('click', async () => {
      const btn = document.getElementById('save-settings-btn');
      const updatedConfig = {
        ...config,
        reviewBeforeSend: document.getElementById('review-toggle').checked,
        autoApply: document.getElementById('auto-apply-toggle').checked,
        apiUrl: document.getElementById('api-url').value.replace(/\/$/, ''),
        scanInterval: Math.max(5, Math.min(1440, parseInt(document.getElementById('scan-interval').value) || 60)),
      };

      await chrome.runtime.sendMessage({ action: 'updateConfig', config: updatedConfig });
      chrome.alarms.create('autoScan', { periodInMinutes: updatedConfig.scanInterval });

      btn.textContent = 'Saved!';
      setTimeout(() => { btn.textContent = 'Save Settings'; }, 1500);
      checkConnection(updatedConfig.apiUrl);
    });

    // Sync profile — fetches profile from app and saves to extension config
    document.getElementById('sync-profile-btn').addEventListener('click', async () => {
      const btn = document.getElementById('sync-profile-btn');
      btn.textContent = 'Syncing...';
      btn.disabled = true;

      try {
        const { authToken } = await chrome.storage.local.get('authToken');
        const apiUrl = document.getElementById('api-url').value || 'https://jobs.dlvasolutions.com';

        const res = await fetch(`${apiUrl}/api/extension/profile`, {
          headers: { 'Authorization': `Bearer ${authToken}` },
        });

        if (res.ok) {
          const data = await res.json();
          if (data.profile) {
            // Save profile to extension config
            const { config: currentConfig } = await chrome.storage.local.get('config');
            const updatedConfig = { ...currentConfig, profile: data.profile };
            await chrome.runtime.sendMessage({ action: 'updateConfig', config: updatedConfig });
            btn.textContent = 'Synced!';
            setTimeout(() => { btn.textContent = 'Sync Profile from App'; }, 2000);
          } else {
            btn.textContent = 'No profile found. Set it up in the app first.';
            setTimeout(() => { btn.textContent = 'Sync Profile from App'; }, 3000);
          }
        } else {
          btn.textContent = 'Sync failed';
          setTimeout(() => { btn.textContent = 'Sync Profile from App'; }, 2000);
        }
      } catch {
        btn.textContent = 'Sync failed';
        setTimeout(() => { btn.textContent = 'Sync Profile from App'; }, 2000);
      } finally {
        btn.disabled = false;
      }
    });

    // Logout
    document.getElementById('logout-btn').addEventListener('click', async () => {
      await chrome.storage.local.remove(['authToken', 'authRefreshToken', 'userEmail']);
      location.reload();
    });
  }

  async function checkConnection(apiUrl) {
    const statusBar = document.getElementById('status-bar');
    try {
      const { authToken } = await chrome.storage.local.get('authToken');
      const headers = authToken ? { 'Authorization': `Bearer ${authToken}` } : {};
      const res = await fetch(`${apiUrl}/api/extension/config`, { headers });

      if (res.ok) {
        // Connected fine, hide status bar
        statusBar.className = 'status-bar hidden';
      } else if (res.status === 401) {
        statusBar.textContent = 'Session expired, sign in again';
        statusBar.className = 'status-bar status-disconnected';
      } else {
        throw new Error('Not OK');
      }
    } catch {
      statusBar.textContent = 'Not connected, start the app first';
      statusBar.className = 'status-bar status-disconnected';
    }
  }
});
