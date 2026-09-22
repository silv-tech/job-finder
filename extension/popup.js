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
    const config = await chrome.runtime.sendMessage({ action: 'getConfig' });
    const apiUrl = config?.apiUrl || 'https://jobs.dlvasolutions.com';

    // The background worker is the only place that refreshes tokens (refresh
    // tokens are single-use, so two refreshers would log the user out).
    // Only log out when the login is really rejected; on a network or server
    // problem keep the user signed in (the status bar says the server is
    // unreachable) so background auto-apply keeps its tokens.
    let loggedOut = false;
    let reachable = false;
    // Second pass forces a refresh in case the token was revoked early.
    for (const force of [false, true]) {
      const auth = await chrome.runtime.sendMessage({ action: 'refreshAuth', force }).catch(() => null);
      if (auth?.status === 'rejected' || auth?.status === 'signed_out') {
        loggedOut = true;
        break;
      }
      if (!auth?.ok) break; // unavailable: can't tell, stay logged in
      try {
        const { authToken: freshToken } = await chrome.storage.local.get('authToken');
        const res = await fetch(`${apiUrl}/api/auth/session`, {
          headers: { 'Authorization': `Bearer ${freshToken}` },
        });
        if (res.ok) {
          reachable = true;
          break;
        }
        if (res.status !== 401) break; // server error: stay logged in
        if (force) loggedOut = true; // still 401 after a fresh token
      } catch {
        break; // network error: stay logged in
      }
    }

    if (!loggedOut) {
      const { userEmail: freshEmail } = await chrome.storage.local.get('userEmail');
      clearTimeout(loadingTimeout);
      loadingView.classList.add('hidden');
      showMainView(freshEmail || userEmail || 'User', config);
      if (!reachable) {
        const statusBar = document.getElementById('status-bar');
        statusBar.textContent = "Can't reach the server right now. You're still logged in.";
        statusBar.className = 'status-bar status-disconnected';
      }
      return;
    }

    // Login really rejected: clear it and show the login screen
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
    document.getElementById('auto-apply-keywords').value = config?.autoApplyKeywords || '';
    document.getElementById('scan-interval-visible').value = config?.scanInterval ?? 10;
    document.getElementById('max-applies').value = config?.maxAppliesPerCycle ?? 5;
    document.getElementById('min-score').value = config?.minApplyScore ?? 60;
    document.getElementById('daily-ap').value = config?.dailyApBudget ?? 10;
    document.getElementById('max-per-day').value = config?.maxAppliesPerDay ?? 10;
    document.getElementById('max-job-age').value = config?.maxJobAgeHours ?? 24;

    const activeLanes = config?.lanes ?? ['developer', 'automations', 'management', 'exec_assistant', 'general_va'];
    document.querySelectorAll('.lane-toggle').forEach((box) => {
      box.checked = activeLanes.includes(box.value);
    });

    // Today's numbers, straight from the budget the cycle actually enforces.
    const LANE_NAMES = {
      developer: 'Developer',
      automations: 'Automations',
      management: 'Management',
      exec_assistant: 'Exec Assistant',
      general_va: 'General VA',
    };
    function paintToday() {
      chrome.runtime.sendMessage({ action: 'getBudget' }, (b) => {
        if (!b) return;
        const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
        set('today-applied', `${b.applied} / ${b.maxAppliesPerDay}`);
        set('today-points', `${b.apSpent} / ${b.dailyApBudget}`);
        set('today-balance', b.apBalance == null ? 'not read yet' : String(b.apBalance));
        set('today-next-lane', LANE_NAMES[b.nextLane] || b.nextLane || '-');
        const reviewing = document.getElementById('review-toggle').checked;
        set('today-mode', reviewing
          ? 'Review mode: matches are prepared and you get a notification. Nothing sends on its own.'
          : 'Auto-send is ON. Applications go out without review.');

        // Say where the last cycle stopped. "Never run" and "ran but found
        // nothing" used to look identical from out here.
        const c = b.lastCycle;
        if (!c) {
          set('today-last-cycle', 'Last cycle: never run yet.');
        } else {
          const t = new Date(c.at);
          const hhmm = isNaN(t.getTime()) ? '' : t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          set('today-last-cycle', `Last cycle: ${hhmm} - ${c.status}${c.detail ? ' (' + c.detail + ')' : ''}`);
        }
      });
    }
    // Jobs that need a Loom, a test or an external form. These used to exist
    // only as a Chrome notification, which disappears and takes the job with it.
    function esc(s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function paintManual() {
      chrome.runtime.sendMessage({ action: 'getManualQueue' }, (queue) => {
        const card = document.getElementById('manual-card');
        const list = document.getElementById('manual-list');
        if (!card || !list) return;
        if (!queue || queue.length === 0) {
          card.classList.add('hidden');
          return;
        }
        card.classList.remove('hidden');
        document.getElementById('manual-count').textContent = '(' + queue.length + ')';
        list.innerHTML = queue.map((m) => `
          <div style="background:#ffffff;border:1px solid #fde68a;border-radius:8px;padding:8px 10px;">
            <a href="${esc(m.apply_url)}" target="_blank" rel="noopener"
               style="font-size:12px;font-weight:600;color:#92400e;text-decoration:none;">${esc(m.title)}</a>
            <div style="font-size:11px;color:#b45309;padding-top:2px;">
              ${m.score ? esc(m.score) + '% match &middot; ' : ''}${esc((m.requirements || []).join(', '))}
            </div>
            <button class="manual-done" data-url="${esc(m.apply_url)}"
                    style="margin-top:6px;background:none;border:none;padding:0;font-size:11px;color:#a16207;cursor:pointer;text-decoration:underline;">
              Done, remove it
            </button>
          </div>`).join('');
        list.querySelectorAll('.manual-done').forEach((btn) => {
          btn.addEventListener('click', () => {
            chrome.runtime.sendMessage(
              { action: 'clearManualJob', apply_url: btn.dataset.url },
              () => paintManual()
            );
          });
        });
      });
    }

    // The end-of-day report: what actually went out, with the full message, so
    // he can judge the writing without asking anyone to dig it out.
    const LANE_SHORT = {
      developer: 'Dev', automations: 'Auto', management: 'Mgmt',
      exec_assistant: 'EA', general_va: 'VA',
    };

    function paintReport() {
      const list = document.getElementById('report-list');
      const summary = document.getElementById('report-summary');
      if (!list || !summary) return;
      chrome.runtime.sendMessage({ action: 'getTodayApplications' }, (res) => {
        if (!res || res.error) {
          summary.textContent = res && res.error ? 'Could not load: ' + res.error : 'Could not load.';
          list.innerHTML = '';
          return;
        }
        const apps = res.applications || [];
        if (apps.length === 0) {
          summary.textContent = 'Nothing sent yet today.';
          list.innerHTML = '';
          return;
        }
        summary.textContent = `${res.sent} sent, ${res.points} point${res.points === 1 ? '' : 's'} spent`
          + (res.needs_manual ? `, ${res.needs_manual} needing you` : '');

        list.innerHTML = apps.map((a, i) => {
          const manual = a.status === 'needs_manual';
          const time = a.sent_at ? new Date(a.sent_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
          const tone = manual ? '#b45309' : (a.score >= 85 ? '#047857' : a.score >= 70 ? '#0f172a' : '#64748b');
          return `
          <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;padding:8px 10px;">
            <a href="${esc(a.apply_url)}" target="_blank" rel="noopener"
               style="font-size:12px;font-weight:600;color:#1d4ed8;text-decoration:none;">${esc(a.title)}</a>
            <div style="font-size:11px;color:#64748b;padding-top:2px;">
              <span style="color:${tone};font-weight:600;">${manual ? 'needs you' : esc(a.score) + '%'}</span>
              &middot; ${esc(LANE_SHORT[a.lane] || a.lane || '')}
              &middot; ${esc(a.apply_points)} pt${a.apply_points === 1 ? '' : 's'}
              ${time ? '&middot; ' + esc(time) : ''}
            </div>
            <div style="font-size:11px;color:#1e293b;padding-top:4px;"><b>${esc(a.subject)}</b></div>
            ${a.message ? `<button class="msg-toggle" data-i="${i}"
                style="margin-top:4px;background:none;border:none;padding:0;font-size:11px;color:#64748b;cursor:pointer;text-decoration:underline;">read the message</button>
              <div class="msg-body hidden" data-i="${i}"
                style="margin-top:6px;font-size:11px;color:#334155;line-height:1.5;white-space:pre-wrap;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:8px;">${esc(a.message)}</div>` : ''}
          </div>`;
        }).join('');

        list.querySelectorAll('.msg-toggle').forEach((btn) => {
          btn.addEventListener('click', () => {
            const body = list.querySelector(`.msg-body[data-i="${btn.dataset.i}"]`);
            if (!body) return;
            const open = !body.classList.contains('hidden');
            body.classList.toggle('hidden', open);
            btn.textContent = open ? 'read the message' : 'hide the message';
          });
        });
      });
    }

    document.getElementById('report-refresh').addEventListener('click', paintReport);

    paintToday();
    paintManual();
    paintReport();
    setInterval(paintToday, 5000);
    setInterval(paintManual, 10000);

    // Show/hide auto-apply config + countdown timer
    if (config?.autoApply) {
      document.getElementById('auto-apply-config').classList.remove('hidden');
      startCountdownTimer();
    }

    function startCountdownTimer() {
      const timerEl = document.getElementById('auto-apply-timer');
      if (!timerEl) return;

      function updateTimer() {
        chrome.alarms.get('autoScan', (alarm) => {
          if (!alarm) {
            timerEl.textContent = 'Auto-apply is active';
            return;
          }
          const remaining = Math.max(0, alarm.scheduledTime - Date.now());
          const mins = Math.floor(remaining / 60000);
          const secs = Math.floor((remaining % 60000) / 1000);
          timerEl.innerHTML = `Next scan in <strong>${mins}m ${secs.toString().padStart(2, '0')}s</strong>`;
        });
      }

      updateTimer();
      setInterval(updateTimer, 1000);
    }
    document.getElementById('api-url').value = config?.apiUrl || 'https://jobs.dlvasolutions.com';
    document.getElementById('scan-interval').value = config?.scanInterval || 60;

    // Auto-save toggles when changed
    document.getElementById('review-toggle').addEventListener('change', () => saveSettings());
    document.getElementById('auto-apply-keywords').addEventListener('change', () => saveSettings());
    document.getElementById('auto-apply-toggle').addEventListener('change', () => {
      const isOn = document.getElementById('auto-apply-toggle').checked;
      document.getElementById('auto-apply-config').classList.toggle('hidden', !isOn);
      saveSettings();
    });
    document.getElementById('scan-interval-visible').addEventListener('change', () => saveSettings());
    document.getElementById('max-applies').addEventListener('change', () => saveSettings());
    document.getElementById('min-score').addEventListener('change', () => saveSettings());
    // Waiting for the alarm is not always possible: its first fire is a full
    // interval away and every extension reload resets that clock.
    document.getElementById('run-now-btn').addEventListener('click', () => {
      const btn = document.getElementById('run-now-btn');
      btn.disabled = true;
      btn.textContent = 'Running...';
      chrome.runtime.sendMessage({ action: 'runCycleNow' }, (res) => {
        btn.disabled = false;
        btn.textContent = 'Run a cycle now';
        if (res && res.status) {
          const el = document.getElementById('today-last-cycle');
          if (el) el.textContent = `Last cycle: just now - ${res.status}${res.detail ? ' (' + res.detail + ')' : ''}`;
        }
        paintToday();
      });
    });

    document.getElementById('clear-seen-btn').addEventListener('click', () => {
      const btn = document.getElementById('clear-seen-btn');
      chrome.runtime.sendMessage({ action: 'clearSeen' }, (res) => {
        const n = res && typeof res.cleared === 'number' ? res.cleared : null;
        btn.textContent = n === null
          ? 'Cleared. Older posts are eligible again.'
          : n === 0
            ? 'Nothing was in the list. Older posts were already eligible.'
            : `Cleared ${n} post${n === 1 ? '' : 's'}. They can be scored again now.`;
        btn.style.color = '#047857';
        setTimeout(() => {
          btn.textContent = 'Re-check older posts (clear the seen list)';
          btn.style.color = '#94a3b8';
        }, 10000);
      });
    });

    document.getElementById('daily-ap').addEventListener('change', () => saveSettings());
    document.getElementById('max-per-day').addEventListener('change', () => saveSettings());
    document.getElementById('max-job-age').addEventListener('change', () => saveSettings());
    document.querySelectorAll('.lane-toggle').forEach((box) => {
      box.addEventListener('change', () => saveSettings());
    });

    // Sends only the settings shown in the popup; the background merges them
    // into the latest stored config so a synced profile is never overwritten.
    function saveSettings() {
      const scanInterval = Math.max(5, Math.min(1440, parseInt(document.getElementById('scan-interval-visible').value) || 60));
      const updatedConfig = {
        reviewBeforeSend: document.getElementById('review-toggle').checked,
        autoApply: document.getElementById('auto-apply-toggle').checked,
        autoApplyKeywords: document.getElementById('auto-apply-keywords').value.trim(),
        apiUrl: document.getElementById('api-url').value.replace(/\/$/, ''),
        scanInterval,
        maxAppliesPerCycle: Math.max(1, Math.min(20, parseInt(document.getElementById('max-applies').value) || 5)),
        minApplyScore: Math.max(10, Math.min(100, parseInt(document.getElementById('min-score').value) || 60)),
        dailyApBudget: Math.max(1, Math.min(60, parseInt(document.getElementById('daily-ap').value) || 10)),
        maxAppliesPerDay: Math.max(1, Math.min(60, parseInt(document.getElementById('max-per-day').value) || 10)),
        maxJobAgeHours: Math.max(1, Math.min(336, parseInt(document.getElementById('max-job-age').value) || 24)),
        lanes: [...document.querySelectorAll('.lane-toggle')].filter((b) => b.checked).map((b) => b.value),
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
      // Save pending scan so background picks it up
      await chrome.storage.local.set({ pendingScanTabSearch: true });
      await chrome.tabs.create({ url: searchUrl });
      e.target.value = '';
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
            await chrome.runtime.sendMessage({ action: 'updateConfig', config: { profile: data.profile } });
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
      statusBar.textContent = "Can't reach the server right now. You're still logged in.";
      statusBar.className = 'status-bar status-disconnected';
    }
  }
});
