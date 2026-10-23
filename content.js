// Banish — content script.
// Runs in two modes:
//   UI mode     – normal TikTok pages: injects block buttons where accounts appear.
//   Worker mode – a hidden profile frame/tab opened with ?tqb_block=<id>: performs the native Block flow.
(() => {
  'use strict';

  const WORKER_PARAM = 'tqb_block';
  const workerId = new URLSearchParams(location.search).get(WORKER_PARAM);

  // ---------- shared helpers ----------
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function waitFor(fn, timeout = 8000, interval = 150) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      (function tick() {
        let v = null;
        try { v = fn(); } catch (_) { /* keep polling */ }
        if (v) return resolve(v);
        if (Date.now() - start > timeout) return reject(new Error('timeout'));
        setTimeout(tick, interval);
      })();
    });
  }

  function hover(el) {
    const opts = { bubbles: true, cancelable: true, view: window };
    for (const t of ['pointerover', 'pointerenter', 'mouseover', 'mouseenter', 'mousemove']) {
      el.dispatchEvent(t.startsWith('pointer') ? new PointerEvent(t, opts) : new MouseEvent(t, opts));
    }
  }

  function realClick(el) {
    hover(el);
    const opts = { bubbles: true, cancelable: true, view: window, button: 0 };
    el.dispatchEvent(new PointerEvent('pointerdown', opts));
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new PointerEvent('pointerup', opts));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.click();
  }

  const exactText = (el, re) => re.test((el.textContent || '').trim());

  function usernameFromHref(href) {
    const m = /\/@([^/?#]+)/.exec(href || '');
    return m ? decodeURIComponent(m[1]).toLowerCase() : null;
  }

  // ---------- worker mode ----------
  if (workerId) {
    runWorker(workerId);
    return;
  }
  if (window !== window.top) return; // never decorate other frames

  function isBlockedProfile() {
    return [...document.querySelectorAll('button, [role="button"]')].some((b) => exactText(b, /^unblock$/i));
  }

  function findBlockMenuItem() {
    const items = document.querySelectorAll(
      '[data-e2e="user-report"] [role="button"], [role="menuitem"], [class*="DivActionContainer"]'
    );
    return [...items].find((e) => exactText(e, /^block$/i));
  }

  function findBlockConfirm() {
    const dialogs = [...document.querySelectorAll('[role="dialog"], [class*="Modal"], [class*="modal"]')]
      .filter((d) => !d.querySelector('[data-e2e="user-report"]'));
    for (const d of dialogs) {
      const btn = [...d.querySelectorAll('button, [role="button"]')].find((b) => exactText(b, /^block$/i));
      if (btn) return btn;
    }
    return null;
  }

  async function runWorker(id) {
    const report = (result) => {
      const msg = { tqb: id, ...result };
      if (window !== window.top) window.parent.postMessage(msg, location.origin);
      else chrome.runtime.sendMessage({ type: 'tqb-worker-result', ...msg });
    };
    try {
      const more = await waitFor(() => document.querySelector('[data-e2e="user-more"]'), 20000);
      if (isBlockedProfile()) return report({ ok: true, already: true });

      let item = null;
      for (let i = 0; i < 4 && !item; i++) {
        hover(more);
        if (i > 0) realClick(more);
        item = await waitFor(findBlockMenuItem, 2000).catch(() => null);
      }
      if (!item) throw new Error('Block option not found');
      realClick(item);

      const confirmBtn = await waitFor(findBlockConfirm, 8000).catch(() => null);
      if (!confirmBtn) throw new Error('Block confirmation not found');
      realClick(confirmBtn);

      await waitFor(isBlockedProfile, 8000).catch(() => null);
      report({ ok: true });
    } catch (e) {
      report({ ok: false, error: e.message || String(e) });
    }
  }

  // ---------- UI mode ----------
  const DEFAULTS = { notInterested: true, confirmFirst: false, autoSkip: true, showInComments: true, dimBlocked: true };
  let settings = { ...DEFAULTS };
  let blocked = {}; // username -> { ts, source }
  const busy = new Set();

  chrome.storage.sync.get(DEFAULTS, (s) => { settings = { ...DEFAULTS, ...s }; scheduleScan(); });
  chrome.storage.local.get({ blocked: {} }, (s) => { blocked = s.blocked || {}; scheduleScan(); });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync') for (const k in changes) settings[k] = changes[k].newValue;
    if (area === 'local' && changes.blocked) blocked = changes.blocked.newValue || {};
    refreshAllStates();
    scheduleScan();
  });

  let selfUser = null;
  function getSelf() {
    if (selfUser) return selfUser;
    const nav = document.querySelector('[data-e2e="nav-profile"]');
    const a = nav && (nav.closest('a') || nav.querySelector('a'));
    let u = usernameFromHref(a && a.getAttribute('href'));
    if (!u) {
      try {
        const data = JSON.parse(document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__').textContent);
        u = (data.__DEFAULT_SCOPE__['webapp.app-context'].user.uniqueId || '').toLowerCase() || null;
      } catch (_) { /* not available */ }
    }
    return (selfUser = u);
  }

  const ICON = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="2.2"/>
    <path d="M6 6l12 12" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>`;
  const ICON_OK = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  function makeButton(variant, username, getItem) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `tqb-btn tqb-${variant}`;
    btn.dataset.tqbUser = username;
    btn.innerHTML = `<span class="tqb-ico">${ICON}</span><span class="tqb-label"></span>`;
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      quickBlock(btn.dataset.tqbUser, getItem ? getItem() : null, variant);
    }, true);
    // Keep TikTok's own handlers (play/pause, open video) from seeing our clicks.
    for (const t of ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'dblclick']) {
      btn.addEventListener(t, (e) => e.stopPropagation());
    }
    applyState(btn);
    return btn;
  }

  function labelFor(btn) {
    const u = btn.dataset.tqbUser;
    if (btn.classList.contains('tqb-busy')) return 'Blocking…';
    if (blocked[u]) return 'Blocked';
    if (btn.classList.contains('tqb-video')) return settings.notInterested ? 'Not interested + Block' : 'Block account';
    return 'Block';
  }

  function applyState(btn) {
    const u = btn.dataset.tqbUser;
    const isBlocked = !!blocked[u];
    btn.classList.toggle('tqb-done', isBlocked);
    btn.classList.toggle('tqb-busy', busy.has(u));
    btn.querySelector('.tqb-ico').innerHTML = isBlocked ? ICON_OK : ICON;
    btn.querySelector('.tqb-label').textContent = labelFor(btn);
    btn.title = isBlocked ? `@${u} is blocked` : `Quick block @${u}`;
    btn.setAttribute('aria-label', btn.title);
    btn.disabled = isBlocked || busy.has(u);
  }

  function refreshAllStates() {
    document.querySelectorAll('.tqb-btn').forEach(applyState);
    document.querySelectorAll('[data-tqb-comment-user]').forEach((el) => {
      el.classList.toggle('tqb-dim', settings.dimBlocked && !!blocked[el.dataset.tqbCommentUser]);
    });
  }

  // ---------- toast ----------
  let toastEl = null, toastTimer = null;
  function toast(html, kind = 'ok') {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'tqb-toast';
      document.documentElement.appendChild(toastEl);
    }
    toastEl.innerHTML = html;
    toastEl.dataset.kind = kind;
    toastEl.classList.add('tqb-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('tqb-show'), 3200);
  }
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- actions ----------
  async function markNotInterested(item) {
    const more = item.querySelector('[data-e2e="more-menu-icon"]');
    if (!more) return false;
    const isOpen = () => {
      const el = document.querySelector('[data-e2e="more-menu-popover_not-interested"]');
      return el && el.getClientRects().length ? el : null;
    };
    hover(more);
    let opt = await waitFor(isOpen, 800).catch(() => null);
    if (!opt) {
      realClick(more);
      opt = await waitFor(isOpen, 2500).catch(() => null);
    }
    if (!opt) return false;
    realClick(opt);
    await sleep(350);
    return true;
  }

  function blockViaFrame(username) {
    return new Promise((resolve) => {
      const id = Math.random().toString(36).slice(2);
      const frame = document.createElement('iframe');
      frame.className = 'tqb-worker-frame';
      frame.setAttribute('aria-hidden', 'true');
      frame.tabIndex = -1;
      frame.src = `${location.origin}/@${encodeURIComponent(username)}?${WORKER_PARAM}=${id}`;
      const finish = (res) => {
        window.removeEventListener('message', onMsg);
        clearTimeout(timer);
        frame.remove();
        resolve(res);
      };
      const onMsg = (e) => {
        if (e.origin === location.origin && e.data && e.data.tqb === id) finish(e.data);
      };
      window.addEventListener('message', onMsg);
      const timer = setTimeout(() => finish({ ok: false, error: 'timeout' }), 25000);
      document.documentElement.appendChild(frame);
    });
  }

  function blockViaTab(username) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: 'tqb-block-in-tab', username }, (res) => {
          resolve(res || { ok: false, error: chrome.runtime.lastError?.message || 'no response' });
        });
      } catch (e) {
        resolve({ ok: false, error: e.message });
      }
    });
  }

  async function blockUser(username) {
    let res = await blockViaFrame(username);
    if (!res.ok) res = await blockViaTab(username); // fallback: background tab
    return res;
  }

  async function quickBlock(username, item, source) {
    if (!username || busy.has(username) || blocked[username]) return;
    if (username === getSelf()) return toast('That’s your own account.', 'err');
    if (settings.confirmFirst && !window.confirm(`Block @${username}?`)) return;

    busy.add(username);
    refreshAllStates();

    let notInterested = false;
    if (item && settings.notInterested) {
      notInterested = await markNotInterested(item).catch(() => false);
    }
    const res = await blockUser(username);
    busy.delete(username);

    if (res.ok) {
      blocked[username] = { ts: Date.now(), source, notInterested };
      chrome.storage.local.set({ blocked });
      toast(`<b>@${esc(username)}</b> blocked${notInterested ? ' · marked <b>Not interested</b>' : ''}`);
      if (item && isMostlyVisible(item)) goNext();
    } else {
      toast(`Couldn’t block <b>@${esc(username)}</b> — ${esc(res.error || 'unknown error')}`, 'err');
    }
    refreshAllStates();
  }

  // ---------- feed / video player ----------
  function isMostlyVisible(el) {
    const r = el.getBoundingClientRect();
    const visible = Math.min(r.bottom, innerHeight) - Math.max(r.top, 0);
    return visible > Math.min(r.height, innerHeight) * 0.6;
  }

  function goNext() {
    const next = document.querySelector('[data-e2e="feed-navigation-next"]');
    if (next) setTimeout(() => realClick(next), 300);
  }

  function feedAuthor(item) {
    const avatar = item.querySelector('[data-e2e="video-author-avatar"]');
    const a = avatar && (avatar.closest('a[href*="/@"]') || avatar.querySelector('a[href*="/@"]'));
    const fromAvatar = usernameFromHref(a && a.getAttribute('href'));
    if (fromAvatar) return fromAvatar;
    const link = [...item.querySelectorAll('a[href*="/@"]')].find((x) => !x.closest('[data-e2e="video-desc"]'));
    return usernameFromHref(link && link.getAttribute('href'));
  }

  // Place the button on the video's top edge, just left of TikTok's own "more" button,
  // so it never sits on top of native controls.
  function positionVideoButton(btn, media, item) {
    const more = item.querySelector('[data-e2e="more-menu-icon"]');
    const m = media.getBoundingClientRect();
    if (more && more.getClientRects().length) {
      const r = more.getBoundingClientRect();
      btn.style.top = `${Math.max(8, Math.round(r.top - m.top + (r.height - 40) / 2))}px`;
      btn.style.right = `${Math.max(8, Math.round(m.right - r.left + 8))}px`;
    } else {
      btn.style.top = '12px';
      btn.style.right = '12px';
    }
  }

  function scanFeed() {
    const self = getSelf();
    document.querySelectorAll('[data-e2e="recommend-list-item-container"]').forEach((item) => {
      const media = item.querySelector('[data-e2e="feed-video"]') || item.querySelector('video')?.closest('section');
      const user = feedAuthor(item);
      if (!media || !user || user === self) return;

      let btn = media.querySelector(':scope > .tqb-video');
      if (!btn) {
        if (getComputedStyle(media).position === 'static') media.classList.add('tqb-host');
        btn = makeButton('video', user, () => item);
        media.appendChild(btn);
      } else if (btn.dataset.tqbUser !== user) {
        btn.dataset.tqbUser = user; // TikTok recycles list items
        applyState(btn);
      }
      positionVideoButton(btn, media, item);

      // Auto-skip videos from accounts you've already blocked.
      if (settings.autoSkip && blocked[user] && item.dataset.tqbSkipped !== user && isMostlyVisible(item)) {
        item.dataset.tqbSkipped = user;
        goNext();
      }
    });
  }

  // ---------- comments & replies ----------
  function scanComments() {
    if (!settings.showInComments) {
      document.querySelectorAll('.tqb-comment').forEach((b) => b.remove());
      return;
    }
    const self = getSelf();
    document.querySelectorAll('[data-e2e^="comment-username-"]').forEach((nameEl) => {
      const a = nameEl.querySelector('a[href*="/@"]');
      const user = usernameFromHref(a && a.getAttribute('href'));
      if (!user || user === self) return;
      const wrapper = nameEl.closest('[class*="CommentItemWrapper"]') || nameEl.parentElement;
      wrapper.dataset.tqbCommentUser = user;
      wrapper.classList.toggle('tqb-dim', settings.dimBlocked && !!blocked[user]);

      let btn = nameEl.nextElementSibling;
      if (!btn || !btn.classList.contains('tqb-comment')) {
        btn = makeButton('comment', user, null);
        nameEl.after(btn);
      } else if (btn.dataset.tqbUser !== user) {
        btn.dataset.tqbUser = user;
        applyState(btn);
      }
    });
  }

  // ---------- profile header ----------
  function scanProfile() {
    const more = document.querySelector('[data-e2e="user-more"]');
    if (!more) return;
    const user = usernameFromHref(location.pathname);
    const row = more.parentElement;
    let btn = row.querySelector(':scope > .tqb-profile');
    if (!user || user === getSelf() || !document.querySelector('[data-e2e="follow-button"], [data-e2e="message-button"]')) {
      if (btn) btn.remove();
      return;
    }
    if (!btn) {
      btn = makeButton('profile', user, null);
      more.after(btn);
    } else if (btn.dataset.tqbUser !== user) {
      btn.dataset.tqbUser = user;
      applyState(btn);
    }
  }

  // ---------- search results ----------
  function scanSearch() {
    const self = getSelf();
    document.querySelectorAll('[data-e2e="search-card-user-link"]').forEach((link) => {
      const user = usernameFromHref(link.getAttribute('href'));
      if (!user || user === self) return;
      let btn = link.nextElementSibling;
      if (!btn || !btn.classList.contains('tqb-search')) {
        btn = makeButton('search', user, null);
        link.after(btn);
      }
    });
  }

  // ---------- scheduler ----------
  let scanQueued = false;
  function scheduleScan() {
    if (scanQueued) return;
    scanQueued = true;
    setTimeout(() => {
      scanQueued = false;
      try { scanFeed(); scanComments(); scanProfile(); scanSearch(); } catch (e) { console.debug('[Banish]', e); }
    }, 200);
  }

  new MutationObserver((muts) => {
    // Ignore mutations caused purely by our own elements.
    if (muts.every((m) => [...m.addedNodes, ...m.removedNodes].every((n) => n.classList && (n.classList.contains('tqb-btn') || n.classList.contains('tqb-worker-frame') || n.classList.contains('tqb-toast'))))) return;
    scheduleScan();
  }).observe(document.documentElement, { childList: true, subtree: true });
  addEventListener('resize', scheduleScan);
  addEventListener('scroll', scheduleScan, { passive: true, capture: true });

  // Alt+B → quick-block the author of the video currently on screen.
  addEventListener('keydown', (e) => {
    if (!e.altKey || e.ctrlKey || e.metaKey || e.code !== 'KeyB') return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    const item = [...document.querySelectorAll('[data-e2e="recommend-list-item-container"]')].find(isMostlyVisible);
    const user = item && feedAuthor(item);
    if (user) {
      e.preventDefault();
      quickBlock(user, item, 'shortcut');
    } else {
      const p = document.querySelector('.tqb-profile');
      if (p) { e.preventDefault(); p.click(); }
    }
  }, true);

  scheduleScan();
})();
