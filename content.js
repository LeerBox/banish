// Banish — content script.
// Runs in two modes:
//   UI mode     – normal TikTok pages: injects block buttons where accounts appear.
//   Worker mode – a hidden profile frame/tab opened with ?tqb_block=<id>: performs the native Block flow.
(() => {
  'use strict';

  const WORKER_PARAM = 'tqb_block';
  // TikTok's router can strip query params on load, so the hidden frame also carries its job in window.name.
  const nameJob = /^tqb_block:([a-z0-9]+)$/.exec(window.name || '');
  const workerId = new URLSearchParams(location.search).get(WORKER_PARAM) || (nameJob && nameJob[1]);

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

  // Synthetic events that look like a real mouse: TikTok's menus ignore pointer events
  // without pointerType "mouse" and a position on the element.
  function mouseOpts(el, extra) {
    const r = el.getBoundingClientRect();
    return {
      bubbles: true, cancelable: true, composed: true, view: window,
      pointerType: 'mouse', pointerId: 1, isPrimary: true, button: 0,
      clientX: Math.round(r.left + r.width / 2), clientY: Math.round(r.top + r.height / 2),
      ...extra,
    };
  }
  function fire(el, type, extra) {
    const opts = mouseOpts(el, extra);
    el.dispatchEvent(type.startsWith('pointer') ? new PointerEvent(type, opts) : new MouseEvent(type, opts));
  }

  function hover(el) {
    for (const t of ['pointerover', 'pointerenter', 'mouseover', 'mouseenter', 'pointermove', 'mousemove']) fire(el, t);
  }

  function realClick(el) {
    hover(el);
    fire(el, 'pointerdown', { buttons: 1 });
    fire(el, 'mousedown', { buttons: 1 });
    fire(el, 'pointerup');
    fire(el, 'mouseup');
    fire(el, 'click');
  }

  const exactText = (el, re) => re.test((el.textContent || '').trim());
  // Must be defined before the worker branch below returns (consts aren't hoisted).
  const isVisible = (el) => !!(el && el.getClientRects().length);

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

  // Background-tab fallback: the tab's URL param may have been stripped too, so ask whether this tab is a job.
  try {
    chrome.runtime.sendMessage({ type: 'tqb-who-am-i' }, (res) => {
      void chrome.runtime.lastError;
      if (res && res.id) runWorker(res.id);
    });
  } catch (_) { /* extension reloaded */ }

  function isBlockedProfile() {
    return [...document.querySelectorAll('button, [role="button"]')]
      .some((b) => !b.classList.contains('tqb-btn') && exactText(b, /^unblock$/i));
  }

  function findBlockMenuItem() {
    const items = document.querySelectorAll(
      '[data-e2e="user-report"] [role="button"], [role="menuitem"], [class*="DivActionContainer"]'
    );
    return [...items].find((e) => isVisible(e) && exactText(e, /^block$/i));
  }

  function findBlockConfirm() {
    const exact = document.querySelector('[data-e2e="block-popup-block-btn"]');
    if (isVisible(exact)) return exact;
    const dialogs = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"], [class*="Modal"], [class*="modal"]')]
      .filter((d) => isVisible(d) && !d.querySelector('[data-e2e="user-report"]'));
    for (const d of dialogs) {
      const buttons = [...d.querySelectorAll('button, [role="button"]')].filter(isVisible);
      const btn = buttons.find((b) => exactText(b, /^block$/i))
        || buttons.find((b) => /TUXButton--primary/.test(b.className) && !exactText(b, /^cancel$/i));
      if (btn) return btn;
    }
    return null;
  }

  async function runWorker(id) {
    const debug = (() => { try { return !!localStorage.getItem('banishDebug'); } catch (_) { return false; } })();
    const log = (...a) => debug && console.log('[Banish worker]', ...a);
    const report = (result) => {
      log('result', result);
      const msg = { tqb: id, ...result };
      if (window !== window.top) window.parent.postMessage(msg, location.origin);
      else chrome.runtime.sendMessage({ type: 'tqb-worker-result', ...msg });
    };
    // Tell the parent we're alive, so it can tell "never started" apart from "got stuck".
    if (window !== window.top) window.parent.postMessage({ tqb: id, alive: true }, location.origin);
    let step = 'Profile didn’t load';
    try {
      const more = await waitFor(() => {
        const el = document.querySelector('[data-e2e="user-more"]');
        return isVisible(el) ? el : null;
      }, 20000);
      log('profile loaded');
      if (isBlockedProfile()) return report({ ok: true, already: true });

      step = 'Block option not found in the ⋯ menu';
      let item = null;
      // The ⋯ menu opens on click (hover alone doesn't open it in a background frame).
      for (let i = 0; i < 4 && !item; i++) {
        item = findBlockMenuItem();
        if (item) break;
        realClick(more);
        item = await waitFor(findBlockMenuItem, 1500).catch(() => null);
      }
      if (!item) throw new Error(step);
      log('menu item found');
      realClick(item);

      step = 'Block confirmation dialog not found';
      const confirmBtn = await waitFor(findBlockConfirm, 8000);
      log('confirm found', confirmBtn.textContent.trim());
      realClick(confirmBtn);

      step = 'TikTok didn’t confirm the block';
      await waitFor(() => isBlockedProfile() || (!findBlockConfirm() && !isVisible(confirmBtn) && 'closed'), 8000);
      // Give TikTok a moment to finish the request, then double-check.
      await sleep(800);
      report({ ok: true, verified: isBlockedProfile() });
    } catch (e) {
      report({ ok: false, error: step });
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

  // The Banish mark: a ban sign with TikTok-style cyan/red split layers that separate on hover.
  const BAN = '<circle cx="12" cy="12" r="7.6"/><path d="M6.6 6.6l10.8 10.8"/>';
  const CHECK = '<path d="M6 12.4l4 4L18.2 8"/>';
  const glyph = (shape) => `<svg class="tqb-glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <g class="tqb-l tqb-l-c">${shape}</g><g class="tqb-l tqb-l-r">${shape}</g><g class="tqb-l tqb-l-w">${shape}</g></svg>`;
  const ICON = glyph(BAN);
  const ICON_OK = glyph(CHECK);

  // ---------- branded tooltip ----------
  let tipEl = null;
  function showTip(btn) {
    if (!tipEl) {
      tipEl = document.createElement('div');
      tipEl.className = 'tqb-tip';
      tipEl.setAttribute('role', 'tooltip');
      document.documentElement.appendChild(tipEl);
    }
    const u = btn.dataset.tqbUser;
    tipEl.innerHTML = `<div class="tqb-tip-title"><span class="tqb-tip-brand">Banish</span> @${esc(u)}</div>
      <div class="tqb-tip-sub">${esc(btn.dataset.tip || '')}</div>`;
    tipEl.classList.add('tqb-show');
    const r = btn.getBoundingClientRect();
    const t = tipEl.getBoundingClientRect();
    const below = r.top < t.height + 16;
    const left = Math.min(Math.max(8, r.left + r.width / 2 - t.width / 2), innerWidth - t.width - 8);
    tipEl.style.left = `${Math.round(left)}px`;
    tipEl.style.top = `${Math.round(below ? r.bottom + 8 : r.top - t.height - 8)}px`;
    tipEl.dataset.side = below ? 'below' : 'above';
  }
  const hideTip = () => tipEl && tipEl.classList.remove('tqb-show');

  function makeButton(variant, username, getItem) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `tqb-btn tqb-${variant}`;
    btn.dataset.tqbUser = username;
    btn.innerHTML = `<span class="tqb-ico">${ICON}</span><span class="tqb-label"></span>`;
    btn.addEventListener('mouseenter', () => showTip(btn));
    btn.addEventListener('focus', () => showTip(btn));
    btn.addEventListener('mouseleave', hideTip);
    btn.addEventListener('blur', hideTip);
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
    if (busy.has(u)) return 'Banishing…';
    if (blocked[u]) return 'Banished';
    return 'Banish';
  }

  function tipFor(btn) {
    const u = btn.dataset.tqbUser;
    if (busy.has(u)) return 'Working on it…';
    if (blocked[u]) return 'Already blocked';
    if (btn.classList.contains('tqb-video') && settings.notInterested) return 'Not interested + Block · Alt+B';
    return 'Block this account';
  }

  function applyState(btn) {
    const u = btn.dataset.tqbUser;
    const isBlocked = !!blocked[u];
    const isBusy = busy.has(u);
    const wasBlocked = btn.classList.contains('tqb-done');
    btn.classList.toggle('tqb-done', isBlocked);
    btn.classList.toggle('tqb-busy', isBusy);
    if (wasBlocked !== isBlocked || !btn.querySelector('.tqb-glyph')) {
      btn.querySelector('.tqb-ico').innerHTML = isBlocked ? ICON_OK : ICON;
    }
    btn.querySelector('.tqb-label').textContent = labelFor(btn);
    btn.dataset.tip = tipFor(btn);
    btn.setAttribute('aria-label', `Banish @${u}: ${btn.dataset.tip}`);
    // aria-disabled instead of disabled so the tooltip still works on finished buttons.
    btn.setAttribute('aria-disabled', String(isBlocked || isBusy));
    if (tipEl && tipEl.classList.contains('tqb-show') && btn.matches(':hover')) showTip(btn);
  }

  function refreshAllStates() {
    document.querySelectorAll('.tqb-btn').forEach(applyState);
    document.querySelectorAll('[data-tqb-comment-user]').forEach((el) => {
      el.classList.toggle('tqb-dim', settings.dimBlocked && !!blocked[el.dataset.tqbCommentUser]);
    });
  }

  // ---------- toast ----------
  let toastEl = null, toastTimer = null;
  // kind: 'ok' | 'err' | 'busy' (busy toasts stay until replaced)
  function toast(html, kind = 'ok') {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'tqb-toast';
      document.documentElement.appendChild(toastEl);
    }
    const ico = kind === 'busy' ? '<span class="tqb-toast-spin"></span>' : kind === 'err' ? ICON : ICON_OK;
    toastEl.innerHTML = `<span class="tqb-toast-ico">${ico}</span><span>${html}</span>`;
    toastEl.dataset.kind = kind;
    toastEl.classList.add('tqb-show');
    clearTimeout(toastTimer);
    if (kind !== 'busy') toastTimer = setTimeout(() => toastEl.classList.remove('tqb-show'), kind === 'err' ? 6000 : 3200);
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
    // The ⋯ menu opens on click (since TikTok's Oct 2026 update hover no longer opens it).
    let opt = isOpen();
    for (let i = 0; i < 2 && !opt; i++) {
      realClick(more);
      opt = await waitFor(isOpen, 1500).catch(() => null);
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
      try { if (localStorage.getItem('banishDebug')) frame.classList.add('tqb-debug'); } catch (_) { /* ignore */ }
      frame.setAttribute('aria-hidden', 'true');
      frame.tabIndex = -1;
      frame.name = `tqb_block:${id}`;
      frame.src = `${location.origin}/@${encodeURIComponent(username)}?${WORKER_PARAM}=${id}`;
      let alive = false;
      const finish = (res) => {
        window.removeEventListener('message', onMsg);
        clearTimeout(timer);
        frame.remove();
        resolve(res);
      };
      const onMsg = (e) => {
        if (e.origin !== location.origin || !e.data || e.data.tqb !== id) return;
        if (e.data.alive) { alive = true; return; }
        finish(e.data);
      };
      window.addEventListener('message', onMsg);
      const timer = setTimeout(() => finish({
        ok: false,
        error: alive ? 'Timed out while blocking' : 'Hidden profile frame never started',
      }), 25000);
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

  // Opens the account's profile in a hidden frame and presses TikTok's own ⋯ → Block → Block.
  // If the frame can't finish, the same steps run in a background tab.
  async function blockUser(username) {
    const errors = [];
    for (const [name, method] of [['frame', blockViaFrame], ['tab', blockViaTab]]) {
      if (name !== 'frame') toast(`Still working on <b>@${esc(username)}</b>… trying another way`, 'busy');
      const res = await method(username);
      console.info(`[Banish] block via ${name}:`, res);
      if (res.ok) return { ...res, via: name };
      errors.push(`${name}: ${res.error}`);
    }
    console.warn('[Banish] block failed', errors);
    return { ok: false, error: errors.join(' · ') };
  }

  async function quickBlock(username, item, source) {
    if (!username || busy.has(username) || blocked[username]) return;
    if (username === getSelf()) return toast('That’s your own account.', 'err');
    if (settings.confirmFirst && !window.confirm(`Block @${username}?`)) return;

    busy.add(username);
    refreshAllStates();

    // Step 1 — Not interested (videos only).
    let notInterested = false;
    if (item && settings.notInterested) {
      toast(`Marking <b>Not interested</b>…`, 'busy');
      notInterested = await markNotInterested(item).catch(() => false);
    }
    // Step 2 — block the account that posted it (username was captured before step 1 changed the feed).
    toast(`${notInterested ? 'Not interested ✓ · ' : ''}Blocking <b>@${esc(username)}</b>…`, 'busy');
    const res = await blockUser(username);
    busy.delete(username);

    if (res.ok) {
      blocked[username] = { ts: Date.now(), source, notInterested };
      chrome.storage.local.set({ blocked });
      toast(`Banished <b>@${esc(username)}</b>${notInterested ? ' · less content like this' : ''}`);
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
    // TikTok wraps ⋯ in single-child containers; place our button after the outermost one,
    // in the same row as Follow / Message / Share, so it never sits inside ⋯'s own box.
    let anchor = more;
    for (let i = 0; i < 3; i++) {
      const p = anchor.parentElement;
      if (!p || [...p.children].filter((c) => !c.classList.contains('tqb-btn')).length !== 1) break;
      anchor = p;
    }
    const row = anchor.parentElement;
    let btn = row.querySelector(':scope > .tqb-profile');
    if (!user || user === getSelf() || !document.querySelector('[data-e2e="follow-button"], [data-e2e="message-button"]')) {
      if (btn) btn.remove();
      return;
    }
    if (!btn) {
      btn = makeButton('profile', user, null);
      anchor.after(btn);
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

  // ---------- LIVE: host header + chat ----------
  function scanLive() {
    const header = document.querySelector('[data-e2e="live-header-container"]');
    if (header) {
      const link = header.querySelector('a[href*="/@"]');
      const user = usernameFromHref(link && link.getAttribute('href'));
      // Sits right after TikTok's share button, in the same row, same 36px circle.
      const share = header.querySelector('[data-e2e="room-header-share-btn"]');
      const anchor = share ? share.parentElement : header.querySelector('[data-e2e="room-header-follow-btn"]');
      let btn = header.querySelector('.tqb-live-host');
      if (!user || user === getSelf() || !anchor) {
        if (btn) btn.remove();
      } else if (!btn) {
        btn = makeButton('live-host', user, null);
        anchor.after(btn);
      } else if (btn.dataset.tqbUser !== user) {
        btn.dataset.tqbUser = user;
        applyState(btn);
      }
    }

    if (!settings.showInComments) return;
    const self = getSelf();
    // main.js tags each chat name with its @username (data-tqb-user).
    document.querySelectorAll('[data-e2e="message-owner-name"][data-tqb-user]').forEach((nameEl) => {
      const user = nameEl.getAttribute('data-tqb-user');
      let btn = nameEl.nextElementSibling;
      const hasBtn = btn && btn.classList.contains('tqb-chat');
      if (!user || user === self) { if (hasBtn) btn.remove(); return; }
      const row = nameEl.closest('[data-e2e="chat-message"], [data-e2e="enter-message"]') || nameEl.parentElement;
      row.dataset.tqbCommentUser = user;
      row.classList.toggle('tqb-dim', settings.dimBlocked && !!blocked[user]);
      if (!hasBtn) {
        btn = makeButton('chat', user, null);
        nameEl.after(btn);
      } else if (btn.dataset.tqbUser !== user) {
        btn.dataset.tqbUser = user; // chat rows are recycled
        applyState(btn);
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
      try { scanFeed(); scanComments(); scanProfile(); scanSearch(); scanLive(); } catch (e) { console.debug('[Banish]', e); }
    }, 200);
  }

  new MutationObserver((muts) => {
    // Ignore mutations caused purely by our own elements.
    if (muts.every((m) => m.type === 'childList' && [...m.addedNodes, ...m.removedNodes].every((n) => n.classList && (n.classList.contains('tqb-btn') || n.classList.contains('tqb-worker-frame') || n.classList.contains('tqb-toast'))))) return;
    scheduleScan();
  }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-tqb-user'] });
  addEventListener('resize', scheduleScan);
  addEventListener('scroll', () => { hideTip(); scheduleScan(); }, { passive: true, capture: true });

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
      const p = document.querySelector('.tqb-profile, .tqb-live-host');
      if (p) { e.preventDefault(); p.click(); }
    }
  }, true);

  scheduleScan();
})();
