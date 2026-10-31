// Banish — content script.
// Runs in two modes:
//   UI mode     – normal TikTok pages: injects block buttons where accounts appear.
//   Worker mode – a hidden profile frame/tab opened with ?tqb_block=<id>: performs the native Block flow.
(() => {
  'use strict';

  const WORKER_PARAM = 'tqb_block';
  // TikTok's router can strip query params on load, so the hidden frame also carries its job in window.name.
  // (a ":r" suffix marks that the frame already reloaded itself once after a stuck load)
  const nameJob = /^tqb_block:([a-z0-9]+)(:r)?$/.exec(window.name || '');
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
      // Wait for ⋯ — or for "Unblock", which a blocked profile shows instead of ⋯.
      const ready = () => {
        if (isBlockedProfile()) return 'blocked';
        const el = document.querySelector('[data-e2e="user-more"]');
        return isVisible(el) ? el : null;
      };
      let more = await waitFor(ready, 12000).catch(() => null);
      if (!more && !nameJob?.[2] && window !== window.top) {
        // The profile's buttons sometimes stay as grey placeholders; reload this hidden page once.
        log('buttons never appeared — reloading once');
        window.name = `tqb_block:${id}:r`;
        location.reload();
        return;
      }
      if (!more) more = await waitFor(ready, 12000);
      if (more === 'blocked') return report({ ok: true, already: true });
      log('profile loaded');

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
  const DEFAULTS = { notInterested: true, confirmFirst: false, autoSkip: true, showInComments: true, dimBlocked: true, universal: true };
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
    if ((btn.classList.contains('tqb-video') || btn.classList.contains('tqb-cinema')) && settings.notInterested) return 'Not interested + Block · Alt+B';
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
    const more = feedMoreButton(item);
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
      }), 40000); // room for one self-reload of a stuck profile
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

  // "Cinema" layout (TikTok, late Oct 2026): a full-width player where the author, ⋯ and
  // action buttons live in one shared overlay for the playing video, not inside each card.
  const isCinema = () => !!document.querySelector('[data-e2e="anchoring-chrome-host"]');
  const activeItem = () => [...document.querySelectorAll('[data-e2e="recommend-list-item-container"]')].find(isMostlyVisible);

  function feedAuthor(item) {
    const avatar = item.querySelector('[data-e2e="video-author-avatar"]');
    const a = avatar && (avatar.closest('a[href*="/@"]') || avatar.querySelector('a[href*="/@"]'));
    const fromAvatar = usernameFromHref(a && a.getAttribute('href'));
    if (fromAvatar) return fromAvatar;
    const link = [...item.querySelectorAll('a[href*="/@"]')].find((x) => !x.closest('[data-e2e="video-desc"]'));
    const fromLink = usernameFromHref(link && link.getAttribute('href'));
    if (fromLink || !isCinema() || item !== activeItem()) return fromLink;
    const id = document.querySelector('[data-e2e="cinema-creator-identity"] a[href*="/@"]');
    return usernameFromHref(id && id.getAttribute('href'));
  }

  function feedMoreButton(item) {
    const own = item.querySelector('[data-e2e="more-menu-icon"]');
    if (own || !isCinema() || item !== activeItem()) return own;
    return document.querySelector('[data-e2e="anchoring-playback-chrome"] [data-e2e="more-menu-icon"]');
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

  // Cinema layout: one Banish button next to the creator's name and Follow, bottom-left.
  function scanCinema() {
    const identity = document.querySelector('[data-e2e="cinema-creator-identity"]');
    let btn = document.querySelector('.tqb-cinema');
    if (btn && (!identity || !identity.contains(btn))) { btn.remove(); btn = null; }
    if (!identity) return;
    const link = identity.querySelector('a[href*="/@"]');
    const user = usernameFromHref(link && link.getAttribute('href'));
    if (!user || user === getSelf()) { if (btn) btn.remove(); return; }
    if (!btn) {
      btn = makeButton('cinema', user, activeItem);
      // Follow is wrapped in TikTok's own boxes; go after the wrapper that sits directly in the row.
      const follow = identity.querySelector('[data-e2e="cinema-video-info-follow"]');
      const slot = follow && [...identity.children].find((c) => c.contains(follow));
      if (slot) slot.after(btn); else identity.appendChild(btn);
    } else if (btn.dataset.tqbUser !== user) {
      btn.dataset.tqbUser = user; // the overlay follows the playing video
      applyState(btn);
    }
  }

  function scanFeed() {
    const self = getSelf();
    const cinema = isCinema();
    if (cinema) {
      scanCinema();
      document.querySelectorAll('.tqb-video').forEach((b) => b.remove());
    }
    document.querySelectorAll('[data-e2e="recommend-list-item-container"]').forEach((item) => {
      const media = item.querySelector('[data-e2e="feed-video"]') || item.querySelector('video')?.closest('section');
      const user = feedAuthor(item);
      if (!media || !user || user === self) return;

      if (cinema) {
        if (settings.autoSkip && blocked[user] && item.dataset.tqbSkipped !== user && isMostlyVisible(item)) {
          item.dataset.tqbSkipped = user;
          goNext();
        }
        return;
      }

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

  // ---------- LIVE cards inside the For You / Following feed ----------
  // The card shows the streamer's name as plain text; the username is in the card's /@user/live link.
  function scanFeedLive() {
    const self = getSelf();
    document.querySelectorAll('[class*="DivRecommendLivePlayerContainer"]').forEach((box) => {
      const link = box.closest('a[href*="/@"]') || box.querySelector('a[href*="/@"]');
      const user = usernameFromHref(link && link.getAttribute('href'));
      const tags = box.querySelector('[class*="DivLiveTagWrapper"]');
      const row = tags && tags.parentElement;
      let btn = box.querySelector('.tqb-feedlive');
      if (!user || user === self || !row) { if (btn) btn.remove(); return; }
      if (!btn) {
        btn = makeButton('feedlive', user, null);
        row.appendChild(btn); // "LIVE now · Following · ⊘ Banish"
      } else if (btn.dataset.tqbUser !== user) {
        btn.dataset.tqbUser = user;
        applyState(btn);
      }
    });
  }

  // ---------- universal layer: any other link to an account ----------
  // Places with a hand-tuned button are skipped; everything else gets either an inline
  // glyph after a name link, or a corner glyph on a whole-card link (search Users tab, sidebar).
  const HANDLED = [
    '[data-e2e^="nav-"]', '[data-e2e="video-desc"]', '[data-e2e^="comment-level-"]',
    '[data-e2e^="comment-username-"]', '[data-e2e="search-card-user-link"]',
    '[data-e2e="cinema-creator-identity"]', '[data-e2e="live-header-container"]',
    '[data-e2e="user-page"] [data-e2e="user-title"]', '[data-e2e="user-subtitle"]',
    '[data-e2e="explore-item"]', '[data-e2e="search_top-item"]', '[data-e2e="user-post-item"]',
    '[class*="DivRecommendLivePlayerContainer"]', '[contenteditable]',
    '[data-e2e="recommend-list-item-container"]', // feed videos have their own button
  ].join(',');

  // Sit just left of the card's own right-side controls (Follow, ⋯), never on top of them.
  function positionCardButton(btn, card, cr) {
    let edge = cr.right;
    card.querySelectorAll('button, [role="button"]').forEach((el) => {
      if (el.classList.contains('tqb-btn')) return;
      const b = el.getBoundingClientRect();
      if (b.width && b.left > cr.left + cr.width / 2) edge = Math.min(edge, b.left);
    });
    btn.style.right = `${Math.round(cr.right - edge + (edge < cr.right ? 8 : 10))}px`;
  }

  function scanUniversal() {
    if (!settings.universal) {
      document.querySelectorAll('.tqb-inline, .tqb-card').forEach((b) => b.remove());
      return;
    }
    const self = getSelf();
    document.querySelectorAll('a[href*="/@"]').forEach((a) => {
      if (a.closest('.tqb-btn') || a.closest(HANDLED)) return;
      // Links nested inside another account link (sidebar rows, search cards): the outer one gets the button.
      if (a.parentElement && a.parentElement.closest('a[href*="/@"]')) return;
      const href = a.getAttribute('href') || '';
      if (/\/@[^/?#]+\/(video|photo)\//.test(href)) return; // links to a post, not an account
      const user = usernameFromHref(href);
      if (!user || user === self) return;
      if (a.dataset.tqbSeen === user && (a.nextElementSibling?.classList.contains('tqb-btn') || a.querySelector(':scope > .tqb-card'))) return;
      const r = a.getBoundingClientRect();
      if (!r.width || !r.height || !a.textContent.trim()) return; // avatar-only links: the name link next to it gets the button
      a.dataset.tqbSeen = user;

      const isCard = r.height > 40 && r.width > 150; // whole row/card is the link
      if (isCard) {
        let btn = a.querySelector(':scope > .tqb-card');
        if (!btn) {
          if (getComputedStyle(a).position === 'static') a.classList.add('tqb-host');
          btn = makeButton('card', user, null);
          a.appendChild(btn);
        } else if (btn.dataset.tqbUser !== user) { btn.dataset.tqbUser = user; applyState(btn); }
        positionCardButton(btn, a, r);
        return;
      }
      // Name link: skip if this card already has a Banish button for the same account.
      const card = a.parentElement && a.parentElement.parentElement;
      if (card && card.querySelector(`.tqb-btn[data-tqb-user="${CSS.escape(user)}"]`) && !a.nextElementSibling?.classList.contains('tqb-inline')) return;
      let btn = a.nextElementSibling;
      if (!btn || !btn.classList.contains('tqb-inline')) {
        btn = makeButton('inline', user, null);
        a.after(btn);
        a.parentElement.dataset.tqbCommentUser = user; // hover reveals the glyph
      } else if (btn.dataset.tqbUser !== user) { btn.dataset.tqbUser = user; applyState(btn); }
    });
  }

  // ---------- LIVE: host header + chat ----------
  function scanLive() {
    const header = document.querySelector('[data-e2e="live-header-container"]');
    if (header) {
      const link = header.querySelector('a[href*="/@"]');
      const user = usernameFromHref(link && link.getAttribute('href'));
      // The header row is [streamer pill (avatar, name, Follow)] [share …]. Banish goes at the end of
      // that row, same 36px circle, so it never lands inside Follow's box even when share is missing.
      const pill = header.querySelector('[role="link"]');
      const share = header.querySelector('[data-e2e="room-header-share-btn"]');
      const row = pill ? pill.parentElement : share && share.parentElement && share.parentElement.parentElement;
      let btn = header.querySelector('.tqb-live-host');
      if (!user || user === getSelf() || !row) {
        if (btn) btn.remove();
      } else {
        if (!btn) btn = makeButton('live-host', user, null);
        else if (btn.dataset.tqbUser !== user) { btn.dataset.tqbUser = user; applyState(btn); }
        if (btn.parentElement !== row || row.lastElementChild !== btn) row.appendChild(btn);
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
      // Hand-tuned placements first, then the universal layer fills every remaining account link.
      for (const scan of [scanFeed, scanFeedLive, scanComments, scanProfile, scanSearch, scanLive, scanUniversal]) {
        try { scan(); } catch (e) { console.debug('[Banish]', scan.name, e); }
      }
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
