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
    const apiUrl = config?.apiUrl || 'http://localhost:3000';

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
        chrome.tabs.create({ url: (c?.apiUrl || 'http://localhost:3000') });
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
      const apiUrl = config?.apiUrl || 'http://localhost:3000';

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
    document.getElementById('api-url').value = config?.apiUrl || 'http://localhost:3000';
    document.getElementById('scan-interval').value = config?.scanInterval || 60;

    // Check connection
    checkConnection(config?.apiUrl || 'http://localhost:3000');

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

    // Open app
    document.getElementById('open-app-btn').addEventListener('click', () => {
      const url = document.getElementById('api-url').value || 'http://localhost:3000';
      chrome.tabs.create({ url });
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

    // Sync profile — opens the app's profile page
    document.getElementById('sync-profile-btn').addEventListener('click', () => {
      const url = document.getElementById('api-url').value || 'http://localhost:3000';
      chrome.tabs.create({ url: url + '?tab=profile' });
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
        const data = await res.json();
        if (data.authenticated) {
          statusBar.textContent = `Connected & authenticated as ${data.user?.email || 'user'}`;
          statusBar.className = 'status-bar status-authed';
        } else {
          statusBar.textContent = 'Connected (not authenticated)';
          statusBar.className = 'status-bar status-connected';
        }
      } else if (res.status === 401) {
        statusBar.textContent = 'Connected but token expired — sign in again';
        statusBar.className = 'status-bar status-disconnected';
      } else {
        throw new Error('Not OK');
      }
    } catch {
      statusBar.textContent = 'Not connected — start the app first';
      statusBar.className = 'status-bar status-disconnected';
    }
  }
});
