// OnlineJobs.ph content script — scrapes job listings and auto-applies
console.log('[JF] Content script loaded on:', window.location.href);

(function () {
  'use strict';

  let overlay = null;
  let isProcessing = false;

  // Listen for messages from background/popup
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Readiness probe. The background polls this instead of sleeping a fixed
    // amount and hoping the page arrived. Reporting the form shape too means
    // one poll answers both "is the script alive" and "is the form usable".
    if (message.action === 'ping') {
      let fields = 0;
      try { fields = detectFormFields().length; } catch (e) { fields = 0; }
      sendResponse({
        ready: document.readyState !== 'loading',
        url: window.location.href,
        fields,
        hasTextarea: !!document.querySelector('textarea'),
      });
      return true;
    }
    if (message.action === 'scanJobs') {
      checkAuthThen(() => scanAndMatch()).then(sendResponse, (err) => sendResponse({ error: err?.message || String(err) }));
      return true;
    }
    if (message.action === 'clickApplyButton') {
      handleClickApplyButton().then(sendResponse, (err) => sendResponse({ error: err?.message || String(err) }));
      return true;
    }
    if (message.action === 'fillApplyForm') {
      handleFillApplyForm(message.job).then(sendResponse, (err) => sendResponse({ error: err?.message || String(err) }));
      return true;
    }
    if (message.action === 'scrapeAndReport') {
      // Background calls this on each page to scrape jobs + get pagination links
      const jobs = scrapeJobListings();
      const pageLinks = [];
      document.querySelectorAll('.pagination a[data-ci-pagination-page], ul.pagination a').forEach((a) => {
        const href = a.href;
        const pageNum = a.getAttribute('data-ci-pagination-page') || a.textContent?.trim();
        if (href && pageNum && !isNaN(parseInt(pageNum))) {
          pageLinks.push({ page: parseInt(pageNum), url: href });
        }
      });
      sendResponse({ jobs, url: window.location.href, pageLinks });
      return true;
    }
    if (message.action === 'autoFillAndSend') {
      handleAutoFillAndSend(message.job).then(sendResponse, (err) => sendResponse({ error: err?.message || String(err) }));
      return true;
    }
    if (message.action === 'showScanProgress') {
      const d = message.data;
      const logHtml = d.pageBreakdown.map(p => `<div>Page ${p.page}: ${p.count} jobs</div>`).join('');
      const statusText = d.currentPage === 'matching'
        ? `Matching ${d.totalJobs} jobs against your profile...`
        : `Scanning page ${d.currentPage} of ${d.maxPages}...`;
      showOverlay(`
        <div class="jf-panel jf-panel-small">
          <div class="jf-panel-body">
            <div class="jf-applying">
              <div class="jf-spinner"></div>
              <p><strong>${d.totalJobs} jobs found</strong></p>
              <p class="jf-status">${statusText}</p>
              <div style="margin-top:12px;text-align:left;font-size:11px;color:#94a3b8;">${logHtml}</div>
            </div>
          </div>
        </div>
      `);
      sendResponse({ ok: true });
      return true;
    }
    if (message.action === 'showLastResults') {
      chrome.storage.local.get(['lastScanResults']).then(({ lastScanResults }) => {
        if (lastScanResults && lastScanResults.length > 0) {
          showMatchResults(lastScanResults);
          sendResponse({ shown: true, count: lastScanResults.length });
        } else {
          sendResponse({ shown: false });
        }
      });
      return true;
    }
  });

  async function handleClickApplyButton() {
    // Check if already applied
    const pageElements = document.querySelectorAll('a, button, span, div');
    for (const el of pageElements) {
      const text = el.textContent?.trim()?.toLowerCase() || '';
      if (text === 'applied' || text.includes('date applied')) {
        return { found: false, navigated: false, already_applied: true, description: '' };
      }
    }

    // Scrape the full job description from the detail page BEFORE navigating away
    let fullDescription = '';
    const descContainers = document.querySelectorAll('.job-description, [class*="description"], [class*="overview"], .job-details');
    descContainers.forEach((el) => {
      const text = el.textContent?.trim() || '';
      if (text.length > fullDescription.length) fullDescription = text;
    });
    // Fallback: grab the main content area
    if (!fullDescription || fullDescription.length < 100) {
      const main = document.querySelector('main, .container, #content, article') || document.body;
      fullDescription = main.textContent?.trim()?.slice(0, 8000) || '';
    }

    // Find the apply button
    const allButtons = document.querySelectorAll('a, button, input[type="submit"]');
    let applyBtn = null;
    for (const btn of allButtons) {
      const text = btn.textContent?.trim()?.toLowerCase() || btn.value?.toLowerCase() || '';
      if (text.includes('apply') && !text.includes('applied')) {
        applyBtn = btn;
        break;
      }
    }

    if (!applyBtn) {
      return { found: false, navigated: false, description: fullDescription };
    }

    if (applyBtn.href) {
      window.location.href = applyBtn.href;
      return { found: true, navigated: true, description: fullDescription };
    } else {
      applyBtn.click();
      return { found: true, navigated: true, description: fullDescription };
    }
  }

  // Wait until the apply form actually exists, rather than guessing with a
  // sleep. A fixed sleep that expires early hard-fails the apply; on the
  // unattended path that happens AFTER markApplied, burning the job. Gate on a
  // textarea too: a half-rendered form (subject present, message not) would
  // otherwise be filled and sent incomplete.
  async function waitForFormFields(timeoutMs = 4000) {
    const deadline = Date.now() + timeoutMs;
    let fields = detectFormFields();
    while (Date.now() < deadline && (fields.length === 0 || !document.querySelector('textarea'))) {
      await sleep(100);
      fields = detectFormFields();
    }
    return fields;
  }

  // Auto fill + send without any UI overlay (used by auto-apply mode)
  async function handleAutoFillAndSend(job) {
    const formFields = await waitForFormFields();
    if (formFields.length === 0) return { success: false, error: 'No form fields' };

    if (!job.description || job.description.length < 100) {
      job.description = document.body.textContent?.slice(0, 6000) || '';
    }

    const application = await chrome.runtime.sendMessage({
      action: 'generateApplication', job, formFields,
    });
    if (application.manual_required) {
      // Not sendable automatically, but the draft is still useful: he sends it
      // by hand once he has recorded the video.
      return {
        success: false,
        manual_required: true,
        requirements: application.requirements,
        application: { subject: application.subject, cover_letter: application.cover_letter },
      };
    }
    if (application.error) return { success: false, error: application.error };

    fillFormFields(formFields, application);

    // Fill apply points with the tier the match earned, not a fixed 2.
    const apToSpend = pointsToSpend(job);
    const pointsInput = findPointsInput();
    if (pointsInput) setInputValue(pointsInput, String(apToSpend));
    const apBalance = readApBalance();

    await sleep(500);

    // Click send email
    let sendBtn = null;
    document.querySelectorAll('a, button, input[type="submit"]').forEach((btn) => {
      const text = btn.textContent?.trim()?.toLowerCase() || btn.value?.toLowerCase() || '';
      if ((text.includes('send') && text.includes('email')) || text.includes('send email')) {
        sendBtn = btn;
      }
    });

    if (sendBtn) {
      sendBtn.click();
      // Report what was spent and the balance the page showed, so the
      // background ledger tracks the real number rather than an estimate.
      // Hand back what was actually sent so it can be recorded for the
      // end-of-day report; the message is otherwise lost at this point.
      return {
        success: true,
        sent: true,
        ap_balance: apBalance,
        ap_spent: apToSpend,
        application: { subject: application.subject, cover_letter: application.cover_letter },
      };
    }
    return { success: false, error: 'Send button not found' };
  }

  // Set once an auto-fill starts on this page, so the "Application Form
  // Detected" prompt (which appears ~1.5s+ after load) never replaces the
  // review popup.
  let fillStarted = false;

  // Verified on the real /apply page: the field is
  // <input type="text" name="points" placeholder="ex. 3">, NOT a number input,
  // so match on name first and keep the old selectors as fallbacks.
  function findPointsInput() {
    return document.querySelector('input[name="points"]')
      || document.querySelector('input[type="number"], input[placeholder*="ex."]');
  }

  // How many points this application should spend. Decided server-side by the
  // match score (src/lib/lanes.ts apForScore); 2 only if nothing was supplied.
  function pointsToSpend(job) {
    // Hard ceiling of 2 per application, by his instruction. Clamped here as
    // well as server-side so no value from the API can ever overspend.
    return Math.max(1, Math.min(2, parseInt(job && job.apply_points, 10) || 2));
  }

  // The apply page states the remaining Apply Points. Reading the real number
  // beats any running total we keep, so the budget is anchored to the truth.
  function readApBalance() {
    const text = document.body.textContent || '';
    const patterns = [
      /you have\s+(\d+)\s+apply\s+points?/i,
      /(\d+)\s+apply\s+points?\s+(?:left|remaining|available)/i,
      /apply\s+points?\s*(?:left|remaining|available)?\s*[:\-]?\s*(\d+)/i,
    ];
    for (const re of patterns) {
      const m = text.match(re);
      if (m) {
        const n = parseInt(m[1], 10);
        if (Number.isFinite(n) && n >= 0 && n <= 200) return n;
      }
    }
    return null;
  }

  async function handleFillApplyForm(job, onStage) {
    fillStarted = true;
    const stage = (text) => { try { if (onStage) onStage(text); } catch (e) { /* caller went away */ } };
    stage('Reading the form...');
    const formFields = await waitForFormFields();

    if (formFields.length === 0) {
      return { success: false, error: 'No form fields found' };
    }

    // Only scrape from current page if no description was passed in
    if (!job.description || job.description.length < 100) {
      const pageDesc = document.body.textContent?.slice(0, 6000) || '';
      job.description = pageDesc;
    }

    // Generate application (the slow step: one AI call)
    stage('Writing your application...');
    const application = await chrome.runtime.sendMessage({
      action: 'generateApplication',
      job,
      formFields,
    });

    if (application.manual_required) {
      showOverlay(`
        <div class="jf-panel jf-panel-small">
          <div class="jf-panel-header">
            <h2>Manual Action Needed</h2>
            <button id="jf-close" class="jf-close-btn">&times;</button>
          </div>
          <div class="jf-panel-body">
            <p class="jf-error" style="margin-bottom:8px;">This job requires something that can't be automated:</p>
            <ul style="margin:0;padding-left:16px;font-size:13px;color:#1e293b;">
              ${application.requirements.map(r => `<li style="margin-bottom:4px;">${escapeHtml(r)}</li>`).join('')}
            </ul>
            <p class="jf-status" style="margin-top:12px;">${application.cover_letter
              ? 'Your application is written below. Record the video, then paste this in and send.'
              : 'The message could not be drafted for this one, so it needs writing by hand as well.'}</p>
            ${application.cover_letter ? `
              <div style="margin-top:10px;">
                <div style="font-size:10px;font-weight:700;letter-spacing:.06em;color:#94a3b8;text-transform:uppercase;">Subject</div>
                <div style="font-size:13px;color:#0f172a;padding:2px 0 8px;">${escapeHtml(application.subject || '')}</div>
                <div style="font-size:10px;font-weight:700;letter-spacing:.06em;color:#94a3b8;text-transform:uppercase;">Message</div>
                <div id="jf-manual-msg" style="font-size:12px;color:#1e293b;line-height:1.5;white-space:pre-wrap;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:8px;margin-top:3px;max-height:200px;overflow-y:auto;">${escapeHtml(application.cover_letter)}</div>
              </div>` : ''}
          </div>
          ${application.cover_letter ? `
            <div class="jf-panel-footer">
              <button id="jf-copy-manual" class="jf-btn jf-btn-apply" style="flex:1;justify-content:center;">Copy the message</button>
            </div>` : ''}
        </div>
      `);

      // Copy straight to the clipboard: he is about to paste it by hand.
      overlay.querySelector('#jf-copy-manual')?.addEventListener('click', async () => {
        const btn = overlay.querySelector('#jf-copy-manual');
        try {
          await navigator.clipboard.writeText(application.cover_letter || '');
          btn.textContent = 'Copied';
        } catch {
          // Clipboard can be refused; select it instead so Ctrl+C works.
          const el = overlay.querySelector('#jf-manual-msg');
          if (el) {
            const range = document.createRange();
            range.selectNodeContents(el);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
          }
          btn.textContent = 'Selected, press Ctrl+C';
        }
        setTimeout(() => { btn.textContent = 'Copy the message'; }, 4000);
      });

      return {
        success: false,
        manual_required: true,
        requirements: application.requirements,
        application: { subject: application.subject, cover_letter: application.cover_letter },
      };
    }

    if (application.error) {
      return { success: false, error: application.error };
    }

    // Fill the form
    stage('Filling in your answers...');
    const filled = fillFormFields(formFields, application);

    // Spend the points the match scored: a stronger fit stands out more. The
    // number is decided server-side (src/lib/lanes.ts apForScore).
    const apToSpend = pointsToSpend(job);
    const pointsInput = findPointsInput();
    if (pointsInput) {
      setInputValue(pointsInput, String(apToSpend));
      filled.push('apply_points');
    }
    const apBalance = readApBalance();

    // Find the Send Email button
    let sendBtn = null;
    document.querySelectorAll('a, button, input[type="submit"]').forEach((btn) => {
      const text = btn.textContent?.trim()?.toLowerCase() || btn.value?.toLowerCase() || '';
      if ((text.includes('send') && text.includes('email')) || text.includes('send email')) {
        sendBtn = btn;
      }
    });

    // Check if review mode is enabled
    const { config } = await chrome.storage.local.get('config');
    const reviewBeforeSend = config?.reviewBeforeSend !== false; // default true

    if (reviewBeforeSend) {
      showReviewPanel({ job, formFields, application, sendBtn });

      // Filled, but the user still has to review and click Send
      return { success: true, pending_review: true, filled: filled.length, ap_balance: apBalance, ap_spent: apToSpend };
    } else {
      // Auto-send without review
      if (!sendBtn) {
        return { success: false, error: 'Send button not found', filled: filled.length };
      }
      await sleep(500);
      sendBtn.click();
      await chrome.runtime.sendMessage({ action: 'saveJob', job });
      await chrome.runtime.sendMessage({ action: 'logApply', job });

      showOverlay(`
        <div class="jf-panel jf-panel-small">
          <div class="jf-panel-header">
            <h2>Application Sent!</h2>
            <button id="jf-close" class="jf-close-btn">&times;</button>
          </div>
          <div class="jf-panel-body">
            <p class="jf-success">Successfully applied to <strong>${escapeHtml(job.title)}</strong></p>
            <p>Filled ${filled.length} fields and submitted automatically.</p>
          </div>
        </div>
      `);
    }

    return { success: true, sent: true, filled: filled.length, ap_balance: apBalance, ap_spent: apToSpend };
  }

  // Review popup: shows the detected role focus (switchable), the subject and
  // message, and lets the user regenerate or improve before sending. Every
  // rewrite refills the form on the page.
  function findFilledEl(value, selector) {
    if (!value) return null;
    return [...document.querySelectorAll(selector)].find((el) => el.value === value) || null;
  }

  function showReviewPanel(ctx) {
    const { job, formFields, sendBtn } = ctx;
    const app = ctx.application;
    ctx.messageEl = findFilledEl(app.cover_letter, 'textarea');
    ctx.subjectEl = findFilledEl(app.subject, 'input[type="text"], input:not([type])');

    const roles = Array.isArray(app.roles) ? app.roles : [];
    const roleOptions = [`<option value="general" ${!app.role ? 'selected' : ''}>General</option>`]
      .concat(roles.map((r) => `<option value="${escapeHtml(r.key)}" ${r.key === app.role ? 'selected' : ''}>${escapeHtml(r.label)}</option>`))
      .join('');
    const label = 'font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;margin-bottom:4px;';
    const secondaryBtn = 'flex:1;justify-content:center;padding:8px 10px;font-size:12px;';

    showOverlay(`
      <div class="jf-panel">
        <div class="jf-panel-header">
          <h2>Review Application</h2>
          <button id="jf-close" class="jf-close-btn">&times;</button>
        </div>
        <div class="jf-panel-body">
          <div style="margin-bottom:12px;">
            <div style="${label}">Job</div>
            <div style="font-weight:600;color:#111827;">${escapeHtml(job.title)}</div>
            <div style="font-size:12px;color:#6b7280;">${escapeHtml(job.company || '')}</div>
          </div>
          <div style="margin-bottom:12px;display:flex;align-items:center;gap:8px;">
            <div style="${label}margin-bottom:0;">Focus</div>
            <select id="jf-role" style="flex:1;border:1px solid #e5e7eb;border-radius:8px;padding:6px 8px;font-size:13px;background:#fff;color:#111827;">${roleOptions}</select>
          </div>
          <div style="margin-bottom:12px;">
            <div style="${label}">Subject</div>
            <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:8px 12px;font-size:13px;">${escapeHtml(app.subject || '')}</div>
          </div>
          <div style="margin-bottom:12px;">
            <div style="${label}">Message</div>
            <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:10px 12px;font-size:13px;white-space:pre-wrap;line-height:1.5;max-height:250px;overflow-y:auto;">${escapeHtml(app.cover_letter || '')}</div>
          </div>
          <div style="display:flex;gap:8px;margin-bottom:10px;">
            <button id="jf-regen" class="jf-btn jf-btn-save" style="${secondaryBtn}">Regenerate</button>
            <button id="jf-better" class="jf-btn jf-btn-save" style="${secondaryBtn}">Make it better</button>
          </div>
          <p id="jf-review-status" class="jf-status" style="margin:0 0 8px;min-height:16px;"></p>
          <div style="margin-bottom:8px;">
            <div style="${label}">Apply Points</div>
            <div style="font-size:13px;">2 points</div>
          </div>
          ${app.fact_checked === false ? `
          <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:8px 12px;font-size:12px;color:#991b1b;margin-bottom:8px;">
            This one couldn't be fact-checked (the AI service had a problem). Read it carefully before sending, or click Regenerate.
          </div>` : ''}
          ${app.hidden_instructions_found ? `
          <div style="background:#fef3c7;border:1px solid #fcd34d;border-radius:8px;padding:8px 12px;font-size:12px;color:#92400e;">
            Hidden instruction found: ${escapeHtml(app.hidden_instructions_found)}
          </div>` : ''}
        </div>
        <div class="jf-panel-footer" style="flex-direction:column;gap:8px;">
          <button id="jf-send" class="jf-btn jf-btn-apply" style="width:100%;justify-content:center;padding:12px 16px;font-size:14px;">Send Application</button>
          <button id="jf-close" class="jf-btn jf-btn-save" style="width:100%;justify-content:center;">Cancel</button>
        </div>
      </div>
    `);

    const status = overlay.querySelector('#jf-review-status');
    const controls = ['#jf-role', '#jf-regen', '#jf-better', '#jf-send'].map((sel) => overlay.querySelector(sel));

    // Current text on the page, so "Make it better" keeps the user's own edits.
    const currentDraft = () => ({
      subject: ctx.subjectEl?.value ?? app.subject ?? '',
      cover_letter: ctx.messageEl?.value ?? app.cover_letter ?? '',
    });

    async function rework(options, busyText) {
      controls.forEach((el) => el && (el.disabled = true));
      status.textContent = busyText;
      status.style.color = '';
      let next;
      try {
        next = await chrome.runtime.sendMessage({ action: 'generateApplication', job, formFields, options });
      } catch (err) {
        next = { error: err?.message || 'Could not reach the extension' };
      }
      if (!next || next.error || next.manual_required) {
        controls.forEach((el) => el && (el.disabled = false));
        status.textContent = next?.error || 'Could not rewrite it, please try again.';
        status.style.color = '#b91c1c';
        return;
      }
      fillFormFields(formFields, next);
      ctx.application = next;
      showReviewPanel(ctx);
    }

    const roleSelect = overlay.querySelector('#jf-role');
    roleSelect?.addEventListener('change', () => {
      const text = roleSelect.options[roleSelect.selectedIndex]?.text || 'this role';
      rework({ role: roleSelect.value }, `Rewriting it for ${text}...`);
    });
    overlay.querySelector('#jf-regen')?.addEventListener('click', () => {
      rework({ role: app.role || 'general', avoid: currentDraft() }, 'Writing a fresh version...');
    });
    overlay.querySelector('#jf-better')?.addEventListener('click', () => {
      rework({ role: app.role || 'general', improve: currentDraft() }, 'Making it better...');
    });

    overlay.querySelector('#jf-send')?.addEventListener('click', async () => {
      const sendBtnEl = overlay.querySelector('#jf-send');
      sendBtnEl.textContent = 'Sending...';
      sendBtnEl.disabled = true;

      if (sendBtn) {
        sendBtn.click();
        // Only now is it really applied
        await chrome.runtime.sendMessage({ action: 'saveJob', job });
        await chrome.runtime.sendMessage({ action: 'logApply', job });

        showOverlay(`
          <div class="jf-panel jf-panel-small">
            <div class="jf-panel-header">
              <h2>Application Sent!</h2>
              <button id="jf-close" class="jf-close-btn">&times;</button>
            </div>
            <div class="jf-panel-body">
              <p class="jf-success">Successfully applied to <strong>${escapeHtml(job.title)}</strong></p>
            </div>
          </div>
        `);
      } else {
        showOverlay(`
          <div class="jf-panel jf-panel-small">
            <div class="jf-panel-header">
              <h2>Send Button Not Found</h2>
              <button id="jf-close" class="jf-close-btn">&times;</button>
            </div>
            <div class="jf-panel-body">
              <p class="jf-error">Could not find the Send Email button. Please click it manually.</p>
            </div>
          </div>
        `);
      }
    });
  }

  async function checkAuthThen(fn) {
    const { authenticated } = await chrome.runtime.sendMessage({ action: 'checkAuth' });
    if (!authenticated) {
      showOverlay(`
        <div class="jf-panel jf-panel-small">
          <div class="jf-panel-header">
            <h2>Not Logged In</h2>
            <button id="jf-close" class="jf-close-btn">&times;</button>
          </div>
          <div class="jf-panel-body">
            <p class="jf-error">You need to sign in first. Click the extension icon and log in with your Job Finder account.</p>
          </div>
        </div>
      `);
      return { error: 'Not authenticated' };
    }
    return fn();
  }

  // ========== SCRAPING ==========

  function scrapeJobListings() {
    const jobs = [];
    const seenUrls = new Set();

    // Target the job card containers directly
    const cards = document.querySelectorAll('div.jobpost-cat-box');

    // Fallback: if no cards found with that class, try finding links directly
    if (cards.length === 0) {
      const links = document.querySelectorAll('a[href*="/jobseekers/job/"], a[href*="/job/"]');
      links.forEach((link) => {
        const href = link.href;
        if (!href) return;
        const urlPath = href.replace(/https?:\/\/[^/]+/, '').replace(/[?#].*$/, '');
        if (seenUrls.has(urlPath)) return;
        seenUrls.add(urlPath);
        const idMatch = urlPath.match(/-(\d+)$/) || urlPath.match(/\/(\d+)$/);
        const id = idMatch ? idMatch[1] : Date.now().toString();
        let title = link.textContent?.trim()?.split('\n')[0]?.trim() || '';
        title = title.replace(/\s*(Full\s*Time|Part\s*Time|Freelance|Contract|Any|Gig)\s*/gi, ' ').replace(/\s+/g, ' ').trim();
        if (!title || title.length < 3) return;
        const fullUrl = href.startsWith('http') ? href : `https://www.onlinejobs.ph${href}`;
        jobs.push({ id, title, company: 'Unknown', salary: '', description: '', apply_url: fullUrl, location: 'Philippines (Remote)', source: 'onlinejobs_ph', job_type: 'full-time', posted_at: '', skills: [] });
      });
      return jobs;
    }

    cards.forEach((card) => {
      const link = card.querySelector('a[href*="/jobseekers/job/"]') || card.querySelector('a[href*="/job/"]');
      if (!link) return;

      const href = link.href || link.getAttribute('href');
      if (!href) return;

      // Deduplicate by URL
      const urlPath = href.replace(/https?:\/\/[^/]+/, '').replace(/[?#].*$/, '');
      if (seenUrls.has(urlPath)) return;
      seenUrls.add(urlPath);

      // Extract job ID from slug
      const idMatch = urlPath.match(/-(\d+)$/) || urlPath.match(/\/(\d+)$/);
      const id = idMatch ? idMatch[1] : urlPath.replace(/[^a-z0-9]/gi, '_');

      // Title — get the link's text but exclude child block elements (dl, div, p)
      let title = '';
      const childNodes = link.childNodes;
      for (const node of childNodes) {
        if (node.nodeType === Node.TEXT_NODE) {
          const t = node.textContent?.trim();
          if (t && t.length > 3) { title = t; break; }
        }
        // Check if it's an inline element with title text (span, strong, etc)
        if (node.nodeType === Node.ELEMENT_NODE) {
          const tag = node.tagName?.toLowerCase();
          if (['dl', 'div', 'p', 'ul', 'table'].includes(tag)) continue;
          const t = node.textContent?.trim();
          if (t && t.length > 3) { title = t; break; }
        }
      }

      // Fallback: if no title from text nodes, try the full link text minus known child text
      if (!title) {
        let fullText = link.textContent?.trim() || '';
        // Remove description, date, salary portions
        const descEl = link.querySelector('.desc, [class*="desc"]');
        if (descEl) fullText = fullText.replace(descEl.textContent || '', '');
        const dlEl = link.querySelector('dl');
        if (dlEl) fullText = fullText.replace(dlEl.textContent || '', '');
        title = fullText.split('\n')[0]?.trim() || '';
      }

      // Clean up title
      title = title.replace(/\s*(Full\s*Time|Part\s*Time|Freelance|Contract|Any|Gig)\s*/gi, ' ').replace(/\s+/g, ' ').trim();

      if (!title || title.length < 3) return;

      // Salary — from dd element or text matching
      let salary = '';
      const ddEl = card.querySelector('dd');
      if (ddEl) salary = ddEl.textContent?.trim() || '';
      if (!salary || salary === 'TBD') {
        const cardText = card.textContent || '';
        const salaryMatch = cardText.match(/\$[\d,]+(?:\s*[-–\/]\s*\$?[\d,]+)?(?:\s*\/\s*(?:hr|hour|mo|month|week|year))?/i)
          || cardText.match(/(?:PHP|₱)\s*[\d,]+(?:\s*[-–]\s*[\d,]+)?/i);
        if (salaryMatch) salary = salaryMatch[0].trim();
      }

      // Description
      let description = '';
      const descEl = card.querySelector('.desc, [class*="desc"]');
      if (descEl) description = descEl.textContent?.trim() || '';
      if (!description) {
        const cardText = card.textContent || '';
        description = cardText.replace(title, '').replace(/\s+/g, ' ').trim().slice(0, 3000);
      }

      // Posted date. data-temp carries the full timestamp ("2026-09-22
      // 11:29:08"), so keep the time: being first to a fresh post is the whole
      // game, and a date alone cannot tell a 10-minute-old job from a 20-hour
      // one. Times are Philippine time, same as the site.
      let posted_at = '';
      const dateEl = card.querySelector('[data-temp]');
      if (dateEl) {
        posted_at = dateEl.getAttribute('data-temp')?.trim() || '';
      }
      if (!posted_at) {
        const stampMatch = (card.textContent || '').match(/\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?/);
        if (stampMatch) posted_at = stampMatch[0];
      }

      // Company — text before the bullet/dot before "Posted on"
      let company = '';
      const postedText = card.textContent || '';
      const companyMatch = postedText.match(/([A-Za-z][A-Za-z\s&.]+?)\s*[·•]\s*Posted on/);
      if (companyMatch) company = companyMatch[1].trim();

      // Job type
      let job_type = 'full-time';
      const fullCardText = card.textContent || '';
      if (/part\s*time/i.test(fullCardText)) job_type = 'part-time';
      if (/freelance/i.test(fullCardText)) job_type = 'contract';
      if (/contract/i.test(fullCardText)) job_type = 'contract';

      // Category tags
      const tags = [];
      card.querySelectorAll('a[href*="/search/c/"], .job-tag a').forEach((tag) => {
        const t = tag.textContent?.trim();
        if (t) tags.push(t);
      });

      const fullUrl = href.startsWith('http') ? href : `https://www.onlinejobs.ph${href}`;

      jobs.push({
        id,
        title,
        company: company || 'Unknown Employer',
        salary,
        description,
        apply_url: fullUrl,
        location: 'Philippines (Remote)',
        source: 'onlinejobs_ph',
        job_type,
        posted_at,
        skills: tags,
      });
    });

    return jobs;
  }

  function scrapeJobDetail() {
    // For individual job pages (/jobseekers/job/XXXXX)
    const title = document.querySelector('h1, h2, h3, [class*="title"]')?.textContent?.trim();

    // Use the same scraping logic as handleClickApplyButton (the automated flow)
    let description = '';
    const descContainers = document.querySelectorAll('.job-description, [class*="description"], [class*="overview"], .job-details');
    descContainers.forEach((el) => {
      const text = el.textContent?.trim() || '';
      if (text.length > description.length) description = text;
    });
    // Fallback: grab the main content area (same as automated flow)
    if (!description || description.length < 100) {
      const main = document.querySelector('main, .container, #content, article') || document.body;
      description = main.textContent?.trim()?.slice(0, 8000) || '';
    }

    if (!title) return null;

    const idMatch = window.location.href.match(/-(\d+)(?:\?|$)/) || window.location.href.match(/\/(\d+)(?:\?|$)/);

    // Look for salary
    let salary = '';
    const pageText = document.body.textContent || '';
    const salaryMatch = pageText.match(/\$[\d,]+(?:\s*[-–\/]\s*\$?[\d,]+)?(?:\s*\/\s*(?:hr|hour|mo|month))?/i);
    if (salaryMatch) salary = salaryMatch[0].trim();

    // Try to extract actual company/employer name from the page
    let company = 'OnlineJobs.ph Employer';
    const employerLink = document.querySelector('a[href*="/employer/"]');
    if (employerLink) {
      company = employerLink.textContent?.trim() || company;
    } else {
      // Look for common patterns like "Company:" or "Employer:" labels
      const labels = document.querySelectorAll('strong, b, label, dt, th');
      for (const label of labels) {
        const labelText = label.textContent?.trim()?.toLowerCase() || '';
        if (labelText.includes('company') || labelText.includes('employer')) {
          const next = label.nextSibling || label.nextElementSibling;
          const val = (next?.textContent || '').trim();
          if (val && val.length > 1 && val.length < 100) {
            company = val;
            break;
          }
        }
      }
    }

    return {
      id: idMatch ? idMatch[1] : Date.now().toString(),
      title: title.replace(/\s*(Full\s*Time|Part\s*Time|Freelance|Contract)\s*$/i, '').trim(),
      company,
      salary: salary || '',
      description: description.slice(0, 8000),
      apply_url: window.location.href,
      location: 'Philippines (Remote)',
      source: 'onlinejobs_ph',
    };
  }

  // ========== FORM DETECTION & FILLING ==========

  function detectFormFields() {
    const fields = [];
    const inputs = document.querySelectorAll('input[type="text"], input[type="email"], input[type="tel"], input[type="url"], textarea, select');

    inputs.forEach((input) => {
      // Try multiple ways to find the label
      let label = '';

      // 1. Explicit <label for="...">
      if (input.id) {
        const labelEl = document.querySelector(`label${attrSelector('for', input.id)}`);
        if (labelEl) label = labelEl.textContent?.trim();
      }

      // 2. Wrapping <label>
      if (!label) {
        const parentLabel = input.closest('label');
        if (parentLabel) label = parentLabel.textContent?.trim();
      }

      // 3. Previous sibling or parent text — common on OLJ where labels are plain text above fields
      if (!label) {
        let prev = input.previousElementSibling;
        while (prev && !label) {
          const t = prev.textContent?.trim();
          if (t && t.length < 50) { label = t; break; }
          prev = prev.previousElementSibling;
        }
      }

      // 4. Look at parent's text nodes
      if (!label && input.parentElement) {
        for (const node of input.parentElement.childNodes) {
          if (node.nodeType === Node.TEXT_NODE) {
            const t = node.textContent?.trim();
            if (t && t.length > 2 && t.length < 50) { label = t; break; }
          }
          if (node.nodeType === Node.ELEMENT_NODE && node !== input && !node.querySelector('input, textarea')) {
            const t = node.textContent?.trim();
            if (t && t.length > 2 && t.length < 50) { label = t; break; }
          }
        }
      }

      // 5. Placeholder or name fallback
      if (!label) label = input.placeholder || input.name || '';

      fields.push({
        type: input.tagName.toLowerCase() === 'textarea' ? 'textarea' : input.type || 'text',
        name: input.name || input.id || '',
        id: input.id || '',
        label: label,
        placeholder: input.placeholder || '',
        required: input.required,
        selector: getUniqueSelector(input),
      });
    });

    return fields;
  }

  // Pick the AI value meant for this input. Exact name/id wins; loose
  // substring matching only for names/keys of 3+ chars, so an unnamed input
  // (or one named "q", like a search box) never grabs an unrelated value.
  function findFieldValue(field, label, values) {
    const entries = Object.entries(values).filter(([key, value]) => key && typeof value === 'string');
    const name = (field.name || '').toLowerCase();
    const id = (field.id || '').toLowerCase();

    for (const [key, value] of entries) {
      const k = key.toLowerCase();
      if ((name && k === name) || (id && k === id) || (label && k === label)) return { key, value };
    }
    for (const [key, value] of entries) {
      const k = key.toLowerCase();
      if ((k.length >= 3 && label.includes(k)) || (name.length >= 3 && k.includes(name))) return { key, value };
    }
    return null;
  }

  function fillFormFields(fields, application) {
    const filled = [];

    // Smart fill: match fields by label keywords
    for (const field of fields) {
      const label = (field.label || field.name || field.placeholder || '').toLowerCase();
      let el = null;
      try {
        el = document.querySelector(field.selector);
      } catch {
        // Bad selector: skip this field rather than abort the whole fill
      }
      if (!el) continue;

      // Subject field
      if (label.includes('subject') && application.subject) {
        setInputValue(el, application.subject);
        filled.push('subject');
      }
      // Message / cover letter field
      else if ((label.includes('message') || label.includes('cover') || label.includes('letter'))
        && field.type === 'textarea' && application.cover_letter) {
        setInputValue(el, application.cover_letter);
        filled.push('message');
      }
      // Contact info field
      else if (label.includes('contact')) {
        // Don't overwrite if already has content from OnlineJobs.ph profile
        if (!el.value?.trim()) {
          const contactInfo = [
            application.fields?.phone || '',
            application.fields?.email || '',
          ].filter(Boolean).join('\n');
          if (contactInfo) {
            setInputValue(el, contactInfo);
            filled.push('contact');
          }
        } else {
          filled.push('contact (pre-filled)');
        }
      }
      // Try matching from AI-generated fields
      else if (application.fields) {
        const match = findFieldValue(field, label, application.fields);
        if (match) {
          setInputValue(el, match.value);
          filled.push(match.key);
        }
      }
    }

    // Fallback: if message wasn't filled, find the first big empty textarea
    if (!filled.includes('message') && application.cover_letter) {
      const textareas = document.querySelectorAll('textarea');
      for (const ta of textareas) {
        const label = (ta.closest('label')?.textContent || document.querySelector(`label${attrSelector('for', ta.id)}`)?.textContent || '').toLowerCase();
        if (!ta.value?.trim() && !label.includes('contact')) {
          setInputValue(ta, application.cover_letter);
          filled.push('message');
          break;
        }
      }
    }

    // Fallback: if subject wasn't filled, find subject input
    if (!filled.includes('subject') && application.subject) {
      const inputs = document.querySelectorAll('input[type="text"]');
      for (const input of inputs) {
        const label = (input.closest('label')?.textContent || document.querySelector(`label${attrSelector('for', input.id)}`)?.textContent || input.placeholder || '').toLowerCase();
        if (label.includes('subject') && !input.value?.trim()) {
          setInputValue(input, application.subject);
          filled.push('subject');
          break;
        }
      }
    }

    return filled;
  }

  function setInputValue(element, value) {
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      element.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype,
      'value'
    )?.set;

    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(element, value);
    } else {
      element.value = value;
    }

    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // [attr="value"] with quotes and backslashes escaped; safe for any value.
  function attrSelector(attr, value) {
    return `[${attr}="${String(value).replace(/["\\]/g, '\\$&')}"]`;
  }

  function getUniqueSelector(el) {
    // Quoted attribute selectors: ids/names like "1st-name" or "user.email"
    // are invalid as raw #id selectors and would make querySelector throw.
    if (el.id) return attrSelector('id', el.id);
    if (el.name) return attrSelector('name', el.name);

    const path = [];
    let current = el;
    while (current && current !== document.body) {
      let selector = current.tagName.toLowerCase();
      if (current.className && typeof current.className === 'string') {
        const classes = current.className.trim().split(/\s+/).slice(0, 2).map((c) => CSS.escape(c)).join('.');
        if (classes) selector += '.' + classes;
      }
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter((c) => c.tagName === current.tagName);
        if (siblings.length > 1) {
          selector += `:nth-of-type(${siblings.indexOf(current) + 1})`;
        }
      }
      path.unshift(selector);
      current = current.parentElement;
    }
    return path.join(' > ');
  }

  // ========== OVERLAY UI ==========

  function _handleEscapeKey(e) {
    if (e.key === 'Escape') {
      removeOverlay();
    }
  }

  function showOverlay(content) {
    removeOverlay();

    overlay = document.createElement('div');
    overlay.id = 'jf-overlay';
    overlay.innerHTML = content;
    document.body.appendChild(overlay);

    overlay.querySelector('#jf-close')?.addEventListener('click', removeOverlay);
    document.addEventListener('keydown', _handleEscapeKey);
  }

  function removeOverlay() {
    document.removeEventListener('keydown', _handleEscapeKey);
    if (overlay) {
      overlay.remove();
      overlay = null;
    }
  }

  function showMatchResults(matches) {
    const matchCards = matches.map((m, i) => `
      <div class="jf-match-card" data-index="${i}">
        <div class="jf-match-header">
          <div class="jf-match-score ${m.score >= 70 ? 'jf-score-high' : m.score >= 50 ? 'jf-score-med' : 'jf-score-low'}">
            ${m.score}%
          </div>
          <div class="jf-match-info">
            <div class="jf-match-title">${escapeHtml(m.title)}</div>
            <div class="jf-match-company">${escapeHtml(m.company || '')}${m.posted_at ? ` · ${timeAgo(m.posted_at)}` : ''}</div>
            ${m.salary ? `<div class="jf-match-salary">${escapeHtml(m.salary)}</div>` : ''}
          </div>
        </div>
        <div class="jf-match-reason">${escapeHtml(m.reason)}</div>
        <div class="jf-match-actions">
          ${m.should_apply ? `<button class="jf-btn jf-btn-apply" data-url="${escapeHtml(m.apply_url)}" data-index="${i}">Auto-Apply</button>` : ''}
          <button class="jf-btn jf-btn-save" data-index="${i}">Save</button>
          <a href="${escapeHtml(m.apply_url)}" target="_blank" class="jf-btn jf-btn-view">View</a>
        </div>
      </div>
    `).join('');

    showOverlay(`
      <div class="jf-panel">
        <div class="jf-panel-header">
          <h2>Job Matches (${matches.length})</h2>
          <button id="jf-close" class="jf-close-btn">&times;</button>
        </div>
        <div class="jf-panel-body">
          ${matches.length === 0 ? '<p class="jf-empty">No matching jobs found on this page.</p>' : matchCards}
        </div>
        ${matches.filter(m => m.should_apply).length > 0 ? `
        <div class="jf-panel-footer">
          <button id="jf-apply-all" class="jf-btn jf-btn-apply-all">
            Auto-Apply to All Recommended (${matches.filter(m => m.should_apply).length})
          </button>
        </div>
        ` : ''}
      </div>
    `);

    // Bind apply buttons
    overlay.querySelectorAll('.jf-btn-apply').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        const idx = parseInt(e.target.dataset.index);
        const job = matches[idx];
        e.target.textContent = 'Applying...';
        e.target.disabled = true;

        // Tell background to open a new tab and handle the apply flow
        const result = await chrome.runtime.sendMessage({ action: 'applyInNewTab', job });

        if (result?.manual_required) {
          e.target.textContent = 'Manual';
          e.target.style.background = '#fef3c7';
          e.target.style.color = '#92400e';
        } else if (result?.pending_review) {
          e.target.textContent = 'Review in tab';
        } else if (result?.sent) {
          e.target.textContent = 'Sent!';
          e.target.classList.add('jf-applied');
        } else {
          e.target.textContent = 'Error';
          e.target.title = result?.error || 'Could not apply';
          setTimeout(() => { e.target.textContent = 'Auto-Apply'; e.target.disabled = false; }, 3000);
        }
      });
    });

    overlay.querySelectorAll('.jf-btn-save').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        const idx = parseInt(e.target.dataset.index);
        await chrome.runtime.sendMessage({ action: 'saveJob', job: matches[idx] });
        e.target.textContent = 'Saved!';
        e.target.disabled = true;
      });
    });

    const applyAllBtn = overlay.querySelector('#jf-apply-all');
    if (applyAllBtn) {
      applyAllBtn.addEventListener('click', async () => {
        const recommended = matches.filter((m) => m.should_apply);
        applyAllBtn.disabled = true;

        // Hand the whole list to the background worker. Navigating this tab
        // per job would unload this script and stop the loop after job 1.
        try {
          const res = await chrome.runtime.sendMessage({ action: 'applyAllInBackground', jobs: recommended });
          if (res?.busy) {
            applyAllBtn.textContent = 'Already applying, try again shortly';
            applyAllBtn.disabled = false;
            return;
          }
          applyAllBtn.textContent = res?.review
            ? `Preparing ${res.count} applications for review in new tabs...`
            : `Applying to ${recommended.length} jobs in the background...`;
          applyAllBtn.classList.add('jf-applied');
        } catch (err) {
          applyAllBtn.textContent = `Error: ${err.message}`;
          applyAllBtn.disabled = false;
        }
      });
    }
  }

  function showApplyingOverlay(job) {
    showOverlay(`
      <div class="jf-panel jf-panel-small">
        <div class="jf-panel-header">
          <h2>Applying...</h2>
          <button id="jf-close" class="jf-close-btn">&times;</button>
        </div>
        <div class="jf-panel-body">
          <div class="jf-applying">
            <div class="jf-spinner"></div>
            <p><strong>${escapeHtml(job.title)}</strong></p>
            <p>${escapeHtml(job.company)}</p>
            <p class="jf-status" id="jf-apply-status">Generating AI application...</p>
          </div>
        </div>
      </div>
    `);
  }

  function updateApplyStatus(text) {
    const el = document.getElementById('jf-apply-status');
    if (el) el.textContent = text;
  }

  // ========== CORE LOGIC ==========

  async function _unused_scanAllPages(maxPages) {
    if (isProcessing) return { error: 'Already processing' };
    isProcessing = true;

    try {
      const allJobs = [];
      const pageBreakdown = [];
      const baseUrl = window.location.href.replace(/[&?]page=\d+/, '');
      const separator = baseUrl.includes('?') ? '&' : '?';

      showOverlay(`
        <div class="jf-panel jf-panel-small">
          <div class="jf-panel-body">
            <div class="jf-applying">
              <div class="jf-spinner"></div>
              <p id="jf-page-label">Scanning page 1 of ${maxPages}...</p>
              <p class="jf-status" id="jf-multi-status">Scraping job listings...</p>
              <div id="jf-page-log" style="margin-top:12px;text-align:left;font-size:11px;color:#94a3b8;"></div>
            </div>
          </div>
        </div>
      `);

      // Scrape current page first
      const currentJobs = scrapeJobListings();
      allJobs.push(...currentJobs);
      pageBreakdown.push({ page: 1, count: currentJobs.length });

      const logEl = document.getElementById('jf-page-log');
      if (logEl) logEl.innerHTML = `<div>Page 1: ${currentJobs.length} jobs found</div>`;

      // Fetch remaining pages
      for (let page = 2; page <= maxPages; page++) {
        const labelEl = document.getElementById('jf-page-label');
        const statusEl = document.getElementById('jf-multi-status');
        if (labelEl) labelEl.textContent = `Scanning page ${page} of ${maxPages}...`;
        if (statusEl) statusEl.textContent = `${allJobs.length} jobs found so far...`;

        try {
          const pageUrl = `${baseUrl}${separator}page=${page}`;
          const res = await fetch(pageUrl);
          const html = await res.text();
          const parser = new DOMParser();
          const doc = parser.parseFromString(html, 'text/html');

          // Scrape jobs from the fetched page
          const cards = doc.querySelectorAll('div.jobpost-cat-box');
          const seenUrls = new Set(allJobs.map(j => j.apply_url));

          if (cards.length === 0) {
            if (logEl) logEl.innerHTML += `<div>Page ${page}: no more listings</div>`;
            break;
          }
          const jobsBefore = allJobs.length;

          cards.forEach((card) => {
            const link = card.querySelector('a[href*="/jobseekers/job/"]') || card.querySelector('a[href*="/job/"]');
            if (!link) return;

            const href = link.href || link.getAttribute('href');
            if (!href) return;

            const fullUrl = href.startsWith('http') ? href : `https://www.onlinejobs.ph${href}`;
            if (seenUrls.has(fullUrl)) return;
            seenUrls.add(fullUrl);

            const urlPath = href.replace(/https?:\/\/[^/]+/, '').replace(/[?#].*$/, '');
            const idMatch = urlPath.match(/-(\d+)$/) || urlPath.match(/\/(\d+)$/);
            const id = idMatch ? idMatch[1] : urlPath.replace(/[^a-z0-9]/gi, '_');

            // Title
            let title = '';
            for (const node of link.childNodes) {
              if (node.nodeType === Node.TEXT_NODE) {
                const t = node.textContent?.trim();
                if (t && t.length > 3) { title = t; break; }
              }
              if (node.nodeType === Node.ELEMENT_NODE) {
                const tag = node.tagName?.toLowerCase();
                if (['dl', 'div', 'p', 'ul', 'table'].includes(tag)) continue;
                const t = node.textContent?.trim();
                if (t && t.length > 3) { title = t; break; }
              }
            }
            if (!title) {
              let fullText = link.textContent?.trim() || '';
              const descEl = link.querySelector('.desc, [class*="desc"]');
              if (descEl) fullText = fullText.replace(descEl.textContent || '', '');
              const dlEl = link.querySelector('dl');
              if (dlEl) fullText = fullText.replace(dlEl.textContent || '', '');
              title = fullText.split('\n')[0]?.trim() || '';
            }
            title = title.replace(/\s*(Full\s*Time|Part\s*Time|Freelance|Contract|Any|Gig)\s*/gi, ' ').replace(/\s+/g, ' ').trim();
            if (!title || title.length < 3) return;

            // Salary
            let salary = '';
            const ddEl = card.querySelector('dd');
            if (ddEl) salary = ddEl.textContent?.trim() || '';

            // Description
            let description = '';
            const descEl = card.querySelector('.desc, [class*="desc"]');
            if (descEl) description = descEl.textContent?.trim() || '';

            // Company
            let company = '';
            const cardText = card.textContent || '';
            const companyMatch = cardText.match(/([A-Za-z][A-Za-z\s&.]+?)\s*[·•]\s*Posted on/);
            if (companyMatch) company = companyMatch[1].trim();

            allJobs.push({
              id, title,
              company: company || 'Unknown Employer',
              salary, description,
              apply_url: fullUrl,
              location: 'Philippines (Remote)',
              source: 'onlinejobs_ph',
              job_type: 'full-time',
              posted_at: '',
              skills: [],
            });
          });
          const pageCount = allJobs.length - jobsBefore;
          pageBreakdown.push({ page, count: pageCount });
          if (logEl) logEl.innerHTML += `<div>Page ${page}: ${pageCount} jobs found</div>`;
        } catch {
          if (logEl) logEl.innerHTML += `<div>Page ${page}: failed to load</div>`;
          break;
        }

        await sleep(500);
      }

      if (allJobs.length === 0) {
        showOverlay(`
          <div class="jf-panel jf-panel-small">
            <div class="jf-panel-header">
              <h2>No Jobs Found</h2>
              <button id="jf-close" class="jf-close-btn">&times;</button>
            </div>
            <div class="jf-panel-body">
              <p class="jf-empty">No job listings found across ${maxPages} pages.</p>
            </div>
          </div>
        `);
        return { jobs: 0, matches: 0 };
      }

      // Now match all jobs
      const breakdownHtml = pageBreakdown.map(p => `<div>Page ${p.page}: ${p.count} jobs</div>`).join('');
      showOverlay(`
        <div class="jf-panel jf-panel-small">
          <div class="jf-panel-body">
            <div class="jf-applying">
              <div class="jf-spinner"></div>
              <p>Matching ${allJobs.length} jobs from ${pageBreakdown.length} pages...</p>
              <p class="jf-status">Scoring against your profile...</p>
              <div style="margin-top:12px;text-align:left;font-size:11px;color:#94a3b8;">${breakdownHtml}</div>
            </div>
          </div>
        </div>
      `);

      const result = await chrome.runtime.sendMessage({ action: 'matchJobs', jobs: allJobs });

      if (result.error) {
        showOverlay(`
          <div class="jf-panel jf-panel-small">
            <div class="jf-panel-header">
              <h2>Error</h2>
              <button id="jf-close" class="jf-close-btn">&times;</button>
            </div>
            <div class="jf-panel-body">
              <p class="jf-error">${escapeHtml(result.error)}</p>
            </div>
          </div>
        `);
        return { error: result.error };
      }

      // Save results to storage so they survive refresh
      const matches = result.matches || [];
      await chrome.storage.local.set({ lastScanResults: matches, lastScanTime: Date.now() });

      showMatchResults(matches);
      return { jobs: allJobs.length, matches: matches.length };
    } finally {
      isProcessing = false;
    }
  }

  async function scanAndMatch() {
    if (isProcessing) return { error: 'Already processing' };
    isProcessing = true;

    try {
      const isDetailPage = /\/jobseekers\/job\//.test(window.location.href);

      let jobs;
      if (isDetailPage) {
        const job = scrapeJobDetail();
        jobs = job ? [job] : [];
      } else {
        jobs = scrapeJobListings();
      }

      if (jobs.length === 0) {
        showOverlay(`
          <div class="jf-panel jf-panel-small">
            <div class="jf-panel-header">
              <h2>No Jobs Found</h2>
              <button id="jf-close" class="jf-close-btn">&times;</button>
            </div>
            <div class="jf-panel-body">
              <p class="jf-empty">No job listings detected on this page. Try navigating to the job search page on OnlineJobs.ph.</p>
            </div>
          </div>
        `);
        return { jobs: 0, matches: 0 };
      }

      showOverlay(`
        <div class="jf-panel jf-panel-small">
          <div class="jf-panel-body">
            <div class="jf-applying">
              <div class="jf-spinner"></div>
              <p>Scanning ${jobs.length} jobs...</p>
              <p class="jf-status">Matching with your profile using AI...</p>
            </div>
          </div>
        </div>
      `);

      const result = await chrome.runtime.sendMessage({ action: 'matchJobs', jobs });

      if (result.error) {
        showOverlay(`
          <div class="jf-panel jf-panel-small">
            <div class="jf-panel-header">
              <h2>Error</h2>
              <button id="jf-close" class="jf-close-btn">&times;</button>
            </div>
            <div class="jf-panel-body">
              <p class="jf-error">${escapeHtml(result.error)}</p>
              <p class="jf-status">Check your connection and try again.</p>
            </div>
          </div>
        `);
        return { error: result.error };
      }

      const matches = result.matches || [];
      await chrome.storage.local.set({ lastScanResults: matches, lastScanTime: Date.now() });

      showMatchResults(matches);
      return { jobs: jobs.length, matches: matches.length };
    } finally {
      isProcessing = false;
    }
  }

  async function applyOnCurrentPage(job) {
    // First, scrape the full description from the detail page
    const fullDesc = document.querySelector('.job-description, [class*="description"], .job-details, [class*="overview"]');
    if (fullDesc) {
      job.description = fullDesc.textContent?.trim()?.slice(0, 3000) || job.description;
    }

    updateApplyStatus('Looking for apply button...');
    let formFields = detectFormFields();

    // Find the apply button — OnlineJobs.ph uses various formats
    let applyBtn = null;
    const allButtons = document.querySelectorAll('a, button, input[type="submit"]');
    for (const btn of allButtons) {
      const text = btn.textContent?.trim()?.toLowerCase() || btn.value?.toLowerCase() || '';
      if (text.includes('apply') && !text.includes('applied')) {
        applyBtn = btn;
        break;
      }
    }

    if (applyBtn && formFields.length === 0) {
      updateApplyStatus('Saving job data...');
      await chrome.runtime.sendMessage({ action: 'setPendingApply', job });

      if (applyBtn.href) {
        window.location.href = applyBtn.href;
      } else {
        applyBtn.click();
      }
      return;
    }

    if (formFields.length > 0) {
      await fillAndSubmit(job);
    } else {
      // No form found — try to find any textarea on the page (some sites have inline apply)
      const textareas = document.querySelectorAll('textarea');
      if (textareas.length > 0) {
        await fillAndSubmit(job);
      } else {
        // Nothing was sent, so don't record it as applied
        updateApplyStatus('Apply button clicked! Fill in any remaining details manually.');
      }
    }
  }

  // Uses the same fill + review popup as every other apply path, so the job is
  // only recorded as applied after it's actually sent.
  async function fillAndSubmit(job) {
    updateApplyStatus('Generating AI application...');
    const result = await handleFillApplyForm(job);
    if (result?.error) updateApplyStatus(`AI Error: ${result.error}`);
  }

  // ========== HELPERS ==========

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function timeAgo(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr + (dateStr.includes('T') || dateStr.includes('+') ? '' : ' GMT+0800'));
    if (isNaN(date.getTime())) return '';
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHrs = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHrs < 24) return `${diffHrs}h ago`;
    if (diffDays === 1) return '1 day ago';
    if (diffDays < 30) return `${diffDays} days ago`;
    return dateStr;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  async function checkPendingApply() {
    // Check background script for pending job
    const response = await chrome.runtime.sendMessage({ action: 'getPendingApply' });
    const pendingApply = response?.job;

    if (pendingApply) {
      await chrome.runtime.sendMessage({ action: 'clearPendingApply' });
      await sleep(2000);
      await applyOnCurrentPage(pendingApply);
      return;
    }

    // If on an apply page with a form, show a "Fill Form" button automatically
    if (window.location.href.includes('/apply')) {
      await sleep(1500);
      const formFields = detectFormFields();

      if (formFields.length > 0) {
        let job;

        // Check if we have cached job data from the detail page (user clicked native Apply button)
        const { lastViewedJob } = await chrome.storage.local.get('lastViewedJob');
        if (lastViewedJob) {
          await chrome.storage.local.remove('lastViewedJob');
          job = lastViewedJob;
          job.apply_url = window.location.href; // Update to current apply URL
        } else {
          // Fallback: scrape what we can from the apply page itself
          const pageTitle = document.querySelector('h1, h2, h3, [class*="title"]')?.textContent?.trim() || 'This Position';

          // The apply page might have some job info — grab everything we can
          // Also check the "First contacted for Job:" link which has the job title and URL
          let jobDetailUrl = '';
          const jobLink = document.querySelector('a[href*="/jobseekers/job/"]');
          if (jobLink) jobDetailUrl = jobLink.href;

          // Scrape what we can from this page
          let pageDesc = document.body.textContent?.slice(0, 6000) || '';

          // If we found a link to the job detail page, fetch its content in background
          if (jobDetailUrl) {
            try {
              const res = await fetch(jobDetailUrl);
              const html = await res.text();
              const parser = new DOMParser();
              const doc = parser.parseFromString(html, 'text/html');
              const fullDesc = doc.body.textContent?.slice(0, 8000) || '';
              if (fullDesc.length > pageDesc.length) pageDesc = fullDesc;
            } catch (e) {
              // Could not fetch job detail page
            }
          }

          job = {
            id: Date.now().toString(),
            title: pageTitle,
            company: 'Unknown',
            description: pageDesc,
            apply_url: window.location.href,
            source: 'onlinejobs_ph',
          };
        }

        // An auto-fill already started here (Quick Apply / Auto-Apply / review
        // tabs): don't cover its review popup with this prompt.
        if (fillStarted) return;

        showOverlay(`
          <div class="jf-panel jf-panel-small">
            <div class="jf-panel-header">
              <h2>Application Form Detected</h2>
              <button id="jf-close" class="jf-close-btn">&times;</button>
            </div>
            <div class="jf-panel-body">
              <p>Found ${formFields.length} form fields on this page.</p>
              <p class="jf-status">Click below to auto-fill with your profile.</p>
            </div>
            <div class="jf-panel-footer">
              <button id="jf-autofill" class="jf-btn jf-btn-apply" style="flex:1;justify-content:center;">Auto-Fill Application</button>
            </div>
          </div>
        `);

        overlay.querySelector('#jf-autofill')?.addEventListener('click', async () => {
          const btn = overlay.querySelector('#jf-autofill');
          const body = overlay.querySelector('.jf-panel-body');
          const idleBody = body ? body.innerHTML : '';
          btn.textContent = 'Working...';
          btn.disabled = true;

          // Show which step is running and how long it's been, so a slow AI
          // call is obviously still alive rather than looking stuck.
          const startedAt = Date.now();
          let stageText = 'Reading the form...';
          const paint = () => {
            if (!body) return;
            const secs = Math.round((Date.now() - startedAt) / 1000);
            body.innerHTML = `
              <div class="jf-spinner"></div>
              <p style="margin:0;text-align:center;font-weight:600;">${escapeHtml(stageText)}</p>
              <p class="jf-status" style="text-align:center;">${secs}s${secs >= 45 ? ' - still working, this one is slow' : ''}</p>
            `;
          };
          paint();
          const ticker = setInterval(paint, 1000);

          const failed = (label) => {
            clearInterval(ticker);
            if (body) body.innerHTML = idleBody;
            btn.textContent = label;
            btn.disabled = false;
            setTimeout(() => { btn.textContent = 'Auto-Fill Application'; }, 5000);
          };

          try {
            console.log('[JF] Auto-fill job data:', JSON.stringify(job).slice(0, 500));
            const result = await handleFillApplyForm(job, (text) => { stageText = text; paint(); });
            clearInterval(ticker);
            if (result?.error) failed('Error: ' + result.error);
          } catch (err) {
            console.error('[JF] Auto-fill error:', err);
            failed('Error - try again');
          }
        });
      }
    }
  }

  async function onPageReady() {
    await checkPendingApply();

    // Check if this page was opened from the extension search
    if (window.location.href.includes('onlinejobs.ph') && window.location.href.includes('jobkeyword')) {
      const { pendingScanTabSearch } = await chrome.storage.local.get('pendingScanTabSearch');
      if (pendingScanTabSearch) {
        await chrome.storage.local.remove('pendingScanTabSearch');
        await sleep(2000);
        await scanAndMatch();
      }
    }

    // If on a job detail page, show a floating "Quick Apply" button
    console.log('[JF] onPageReady URL:', window.location.href);
    if (window.location.href.match(/\/jobseekers\/job\/|\/job\/[a-z0-9-]+-\d+/)) {
      console.log('[JF] Detected job detail page, caching job data...');
      await sleep(1500);

      // Always cache the current job detail for manual apply flow
      // If the user clicks the site's native "Apply" button, this data will be available on /apply
      const cachedJob = scrapeJobDetail() || {
        id: (window.location.href.match(/-(\d+)$/) || [])[1] || Date.now().toString(),
        title: document.querySelector('h1, h2')?.textContent?.trim() || 'This Position',
        company: 'Unknown',
        description: document.body.textContent?.slice(0, 8000) || '',
        apply_url: window.location.href,
        source: 'onlinejobs_ph',
      };
      chrome.storage.local.set({ lastViewedJob: cachedJob });

      const applyBtn = document.querySelector('a, button');
      let hasApplyButton = false;
      document.querySelectorAll('a, button').forEach((btn) => {
        const text = btn.textContent?.trim()?.toLowerCase() || '';
        if (text.includes('apply') && !text.includes('applied')) hasApplyButton = true;
      });

      if (hasApplyButton) {
        const floatingBtn = document.createElement('div');
        floatingBtn.id = 'jf-quick-apply';
        floatingBtn.innerHTML = `
          <button id="jf-quick-apply-btn" style="
            display:flex;align-items:center;gap:8px;
            background:#0f172a;color:#fff;border:none;
            padding:12px 20px;border-radius:14px;
            font-size:13px;font-weight:600;cursor:pointer;
            box-shadow:0 4px 20px rgba(0,0,0,0.2);
            font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
            transition:all 0.2s;
          ">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13"/><path d="M22 2L15 22l-4-9-9-4z"/></svg>
            Quick Apply
          </button>
        `;
        floatingBtn.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:99999;';
        document.body.appendChild(floatingBtn);

        floatingBtn.querySelector('#jf-quick-apply-btn').addEventListener('mouseover', (e) => {
          e.target.closest('button').style.transform = 'scale(1.05)';
        });
        floatingBtn.querySelector('#jf-quick-apply-btn').addEventListener('mouseout', (e) => {
          e.target.closest('button').style.transform = 'scale(1)';
        });

        floatingBtn.querySelector('#jf-quick-apply-btn').addEventListener('click', async () => {
          const btn = floatingBtn.querySelector('#jf-quick-apply-btn');
          btn.textContent = 'Applying...';
          btn.style.opacity = '0.7';
          btn.disabled = true;

          // Scrape description from this page
          const job = scrapeJobDetail() || {
            id: Date.now().toString(),
            title: document.querySelector('h1, h2')?.textContent?.trim() || 'This Position',
            company: 'Unknown',
            description: document.body.textContent?.slice(0, 6000) || '',
            apply_url: window.location.href,
            source: 'onlinejobs_ph',
          };

          // Use background script to handle the full flow
          const result = await chrome.runtime.sendMessage({ action: 'navigateAndApply', job });

          if (result?.error) {
            btn.textContent = 'Error: ' + result.error;
            btn.style.opacity = '1';
            setTimeout(() => { btn.textContent = 'Quick Apply'; btn.disabled = false; }, 3000);
          }
        });
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onPageReady);
  } else {
    onPageReady();
  }
})();
