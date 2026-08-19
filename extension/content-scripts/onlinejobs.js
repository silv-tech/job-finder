// OnlineJobs.ph content script — scrapes job listings and auto-applies

(function () {
  'use strict';

  console.log('[Job Finder] Content script loaded on:', window.location.href);

  let overlay = null;
  let isProcessing = false;

  // Listen for messages from background/popup
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'scanJobs') {
      checkAuthThen(() => scanAndMatch()).then(sendResponse);
      return true;
    }
    if (message.action === 'autoScan') {
      checkAuthThen(() => scanAndMatch()).then(() => {});
      return true;
    }
    if (message.action === 'applyToJob') {
      checkAuthThen(() => applyToJob(message.job, message.application)).then(sendResponse);
      return true;
    }
    if (message.action === 'clickApplyButton') {
      handleClickApplyButton().then(sendResponse);
      return true;
    }
    if (message.action === 'fillApplyForm') {
      handleFillApplyForm(message.job).then(sendResponse);
      return true;
    }
  });

  async function handleClickApplyButton() {
    console.log('[Job Finder] clickApplyButton: scraping description and looking for apply button...');

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

    console.log('[Job Finder] Scraped description length:', fullDescription.length);

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
      console.log('[Job Finder] No apply button found');
      return { found: false, navigated: false, description: fullDescription };
    }

    console.log('[Job Finder] Found apply button, clicking...');
    if (applyBtn.href) {
      window.location.href = applyBtn.href;
      return { found: true, navigated: true, description: fullDescription };
    } else {
      applyBtn.click();
      return { found: true, navigated: true, description: fullDescription };
    }
  }

  async function handleFillApplyForm(job) {
    console.log('[Job Finder] fillApplyForm: detecting fields...');
    console.log('[Job Finder] Job description length:', job.description?.length || 0);
    await sleep(1000);

    const formFields = detectFormFields();
    console.log('[Job Finder] Found', formFields.length, 'form fields');

    if (formFields.length === 0) {
      return { success: false, error: 'No form fields found' };
    }

    // Only scrape from current page if no description was passed in
    if (!job.description || job.description.length < 100) {
      const pageDesc = document.body.textContent?.slice(0, 6000) || '';
      job.description = pageDesc;
    }

    // Generate application
    const application = await chrome.runtime.sendMessage({
      action: 'generateApplication',
      job,
      formFields,
    });

    if (application.error) {
      console.log('[Job Finder] AI error:', application.error);
      return { success: false, error: application.error };
    }

    // Fill the form
    const filled = fillFormFields(formFields, application);
    console.log('[Job Finder] Filled fields:', filled);

    // Fill Apply Points with 2
    const pointsInput = document.querySelector('input[type="number"], input[placeholder*="ex."]');
    if (pointsInput) {
      setInputValue(pointsInput, '2');
      filled.push('apply_points');
      console.log('[Job Finder] Set apply points to 2');
    }

    // Save job
    await chrome.runtime.sendMessage({ action: 'saveJob', job });

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
      // Show review popup with subject, message preview, and send button
      const subjectText = application.subject || '';
      const messageText = application.cover_letter || '';

      showOverlay(`
        <div class="jf-panel">
          <div class="jf-panel-header">
            <h2>Review Application</h2>
            <button id="jf-close" class="jf-close-btn">&times;</button>
          </div>
          <div class="jf-panel-body">
            <div style="margin-bottom:12px;">
              <div style="font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;margin-bottom:4px;">Job</div>
              <div style="font-weight:600;color:#111827;">${escapeHtml(job.title)}</div>
              <div style="font-size:12px;color:#6b7280;">${escapeHtml(job.company || '')}</div>
            </div>
            <div style="margin-bottom:12px;">
              <div style="font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;margin-bottom:4px;">Subject</div>
              <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:8px 12px;font-size:13px;">${escapeHtml(subjectText)}</div>
            </div>
            <div style="margin-bottom:12px;">
              <div style="font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;margin-bottom:4px;">Message</div>
              <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:10px 12px;font-size:13px;white-space:pre-wrap;line-height:1.5;max-height:250px;overflow-y:auto;">${escapeHtml(messageText)}</div>
            </div>
            <div style="margin-bottom:8px;">
              <div style="font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;margin-bottom:4px;">Apply Points</div>
              <div style="font-size:13px;">2 points</div>
            </div>
            ${application.hidden_instructions_found ? `
            <div style="background:#fef3c7;border:1px solid #fcd34d;border-radius:8px;padding:8px 12px;font-size:12px;color:#92400e;">
              Hidden instruction found: ${escapeHtml(application.hidden_instructions_found)}
            </div>` : ''}
          </div>
          <div class="jf-panel-footer" style="flex-direction:column;gap:8px;">
            <button id="jf-send" class="jf-btn jf-btn-apply" style="width:100%;justify-content:center;padding:12px 16px;font-size:14px;">Send Application</button>
            <button id="jf-close" class="jf-btn jf-btn-save" style="width:100%;justify-content:center;">Cancel</button>
          </div>
        </div>
      `);

      overlay.querySelector('#jf-send')?.addEventListener('click', async () => {
        const sendBtnEl = overlay.querySelector('#jf-send');
        sendBtnEl.textContent = 'Sending...';
        sendBtnEl.disabled = true;

        if (sendBtn) {
          sendBtn.click();
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
    } else {
      // Auto-send without review
      if (sendBtn) {
        console.log('[Job Finder] Auto-sending...');
        await sleep(500);
        sendBtn.click();
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
    }

    return { success: true, filled: filled.length };
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
      console.log('[Job Finder] No card containers found, found', links.length, 'job links');
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

    console.log('[Job Finder] Found', cards.length, 'job cards on page');

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

      // Posted date
      let posted_at = '';
      const dateEl = card.querySelector('[data-temp]');
      if (dateEl) {
        posted_at = dateEl.getAttribute('data-temp')?.split(' ')[0] || '';
      }
      if (!posted_at) {
        const dateMatch = (card.textContent || '').match(/\d{4}-\d{2}-\d{2}/);
        if (dateMatch) posted_at = dateMatch[0];
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

      console.log('[Job Finder] Scraped:', title, '|', company, '|', salary);

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

    // Get the main content area
    const contentAreas = document.querySelectorAll('p, div, section');
    let description = '';
    contentAreas.forEach((el) => {
      const text = el.textContent?.trim() || '';
      if (text.length > description.length && text.length > 100) {
        description = text;
      }
    });

    if (!title) return null;

    const idMatch = window.location.href.match(/-(\d+)(?:\?|$)/) || window.location.href.match(/\/(\d+)(?:\?|$)/);

    // Look for salary
    let salary = '';
    const pageText = document.body.textContent || '';
    const salaryMatch = pageText.match(/\$[\d,]+(?:\s*[-–\/]\s*\$?[\d,]+)?(?:\s*\/\s*(?:hr|hour|mo|month))?/i);
    if (salaryMatch) salary = salaryMatch[0].trim();

    return {
      id: idMatch ? idMatch[1] : Date.now().toString(),
      title: title.replace(/\s*(Full\s*Time|Part\s*Time|Freelance|Contract)\s*$/i, '').trim(),
      company: 'OnlineJobs.ph Employer',
      salary: salary || '',
      description: description.slice(0, 2000),
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
        const labelEl = document.querySelector(`label[for="${input.id}"]`);
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

    console.log('[Job Finder] Detected fields:', fields.map(f => `${f.label} (${f.type})`).join(', '));
    return fields;
  }

  function fillFormFields(fields, application) {
    const filled = [];

    // Smart fill: match fields by label keywords
    for (const field of fields) {
      const label = (field.label || field.name || field.placeholder || '').toLowerCase();
      const el = document.querySelector(field.selector);
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
        for (const [fieldKey, value] of Object.entries(application.fields)) {
          if (field.name === fieldKey || field.id === fieldKey ||
            label.includes(fieldKey.toLowerCase()) ||
            fieldKey.toLowerCase().includes(field.name.toLowerCase())) {
            setInputValue(el, value);
            filled.push(fieldKey);
            break;
          }
        }
      }
    }

    // Fallback: if message wasn't filled, find the first big empty textarea
    if (!filled.includes('message') && application.cover_letter) {
      const textareas = document.querySelectorAll('textarea');
      for (const ta of textareas) {
        const label = (ta.closest('label')?.textContent || document.querySelector(`label[for="${ta.id}"]`)?.textContent || '').toLowerCase();
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
        const label = (input.closest('label')?.textContent || document.querySelector(`label[for="${input.id}"]`)?.textContent || input.placeholder || '').toLowerCase();
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

  function getUniqueSelector(el) {
    if (el.id) return `#${el.id}`;
    if (el.name) return `[name="${el.name}"]`;

    const path = [];
    let current = el;
    while (current && current !== document.body) {
      let selector = current.tagName.toLowerCase();
      if (current.className && typeof current.className === 'string') {
        const classes = current.className.trim().split(/\s+/).slice(0, 2).join('.');
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

  function showOverlay(content) {
    removeOverlay();

    overlay = document.createElement('div');
    overlay.id = 'jf-overlay';
    overlay.innerHTML = content;
    document.body.appendChild(overlay);

    overlay.querySelector('#jf-close')?.addEventListener('click', removeOverlay);
  }

  function removeOverlay() {
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
            <div class="jf-match-company">${escapeHtml(m.company || '')}</div>
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
        e.target.textContent = 'Applying...';
        e.target.disabled = true;
        await navigateAndApply(matches[idx]);
        e.target.textContent = 'Applied!';
        e.target.classList.add('jf-applied');
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
        applyAllBtn.textContent = `Applying (0/${recommended.length})...`;
        applyAllBtn.disabled = true;

        for (let i = 0; i < recommended.length; i++) {
          applyAllBtn.textContent = `Applying (${i + 1}/${recommended.length})...`;
          await navigateAndApply(recommended[i]);
          await sleep(2000);
        }

        applyAllBtn.textContent = `Done! Applied to ${recommended.length} jobs`;
        applyAllBtn.classList.add('jf-applied');
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
              <p class="jf-status">Make sure your Job Finder app is running on localhost:3000</p>
            </div>
          </div>
        `);
        return { error: result.error };
      }

      showMatchResults(result.matches || []);
      return { jobs: jobs.length, matches: result.matches?.length || 0 };
    } finally {
      isProcessing = false;
    }
  }

  async function navigateAndApply(job) {
    showApplyingOverlay(job);

    try {
      // Let the background script orchestrate the full flow
      const result = await chrome.runtime.sendMessage({ action: 'navigateAndApply', job });
      console.log('[Job Finder] navigateAndApply result:', result);

      if (result?.error) {
        updateApplyStatus(`Error: ${result.error}`);
      }
    } catch (err) {
      updateApplyStatus(`Error: ${err.message}`);
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
      console.log('[Job Finder] Saved pendingApply via background, navigating...');

      if (applyBtn.href) {
        window.location.href = applyBtn.href;
      } else {
        applyBtn.click();
      }
      return;
    }

    if (formFields.length > 0) {
      await fillAndSubmit(job, formFields);
    } else {
      // No form found — try to find any textarea on the page (some sites have inline apply)
      const textareas = document.querySelectorAll('textarea');
      if (textareas.length > 0) {
        await fillAndSubmit(job, detectFormFields());
      } else {
        updateApplyStatus('Apply button clicked! Fill in any remaining details manually.');
        await chrome.runtime.sendMessage({ action: 'saveJob', job });
        await chrome.runtime.sendMessage({ action: 'logApply', job });
      }
    }
  }

  async function fillAndSubmit(job, formFields) {
    updateApplyStatus('Generating AI application...');

    const application = await chrome.runtime.sendMessage({
      action: 'generateApplication',
      job,
      formFields,
    });

    if (application.error) {
      updateApplyStatus(`AI Error: ${application.error}`);
      return;
    }

    updateApplyStatus('Filling form fields...');
    const filled = fillFormFields(formFields, application);

    updateApplyStatus(`Filled ${filled.length} fields. Review before submitting.`);

    await chrome.runtime.sendMessage({ action: 'saveJob', job });
    await chrome.runtime.sendMessage({ action: 'logApply', job });

    const submitBtn = document.querySelector('button[type="submit"], input[type="submit"]');
    if (submitBtn) {
      showOverlay(`
        <div class="jf-panel jf-panel-small">
          <div class="jf-panel-header">
            <h2>Application Ready</h2>
            <button id="jf-close" class="jf-close-btn">&times;</button>
          </div>
          <div class="jf-panel-body">
            <p class="jf-success">Form filled with AI-generated application!</p>
            <p>Filled ${filled.length} fields for <strong>${escapeHtml(job.title)}</strong></p>
            <p class="jf-status">Review the form below, then submit when ready.</p>
          </div>
          <div class="jf-panel-footer">
            <button id="jf-submit" class="jf-btn jf-btn-apply">Submit Application</button>
            <button id="jf-close" class="jf-btn jf-btn-save">Cancel</button>
          </div>
        </div>
      `);

      overlay.querySelector('#jf-submit')?.addEventListener('click', () => {
        submitBtn.click();
        removeOverlay();
      });
    }
  }

  // ========== HELPERS ==========

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
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
    console.log('[Job Finder] checkPendingApply:', pendingApply ? 'FOUND: ' + pendingApply.title : 'no pending job');

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
      console.log('[Job Finder] Apply page detected, fields:', formFields.length);

      if (formFields.length > 0) {
        // Try to get the job title from the page
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
            console.log('[Job Finder] Fetched full description from job page:', fullDesc.length, 'chars');
          } catch (e) {
            console.log('[Job Finder] Could not fetch job detail page:', e.message);
          }
        }

        const job = {
          id: Date.now().toString(),
          title: pageTitle,
          company: 'Unknown',
          description: pageDesc,
          apply_url: window.location.href,
          source: 'onlinejobs_ph',
        };

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
          overlay.querySelector('#jf-autofill').textContent = 'Filling...';
          overlay.querySelector('#jf-autofill').disabled = true;
          await fillAndSubmit(job, formFields);
        });
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkPendingApply);
  } else {
    checkPendingApply();
  }
})();
