// Banish — page-context helper (runs in TikTok's own JS world).
// LIVE chat shows display names only; the @username lives in React props, which the
// content script can't see. This tags each chat name with data-tqb-user="<username>".
(() => {
  'use strict';

  const NAME_SEL = '[data-e2e="message-owner-name"]';

  function scanProps(obj, depth, seen) {
    if (!obj || typeof obj !== 'object' || depth > 3 || seen.has(obj) || obj instanceof Node) return null;
    seen.add(obj);
    for (const k of ['display_id', 'displayId', 'uniqueId', 'unique_id']) {
      if (typeof obj[k] === 'string' && obj[k]) return obj[k];
    }
    for (const k of Object.keys(obj).slice(0, 60)) {
      if (k === 'children' || k.startsWith('_')) continue;
      const v = scanProps(obj[k], depth + 1, seen);
      if (v) return v;
    }
    return null;
  }

  function usernameOf(el) {
    const key = Object.keys(el).find((k) => k.startsWith('__reactFiber'));
    let f = key && el[key];
    for (let i = 0; i < 10 && f; i++, f = f.return) {
      const p = f.memoizedProps;
      const direct = p && p.message && p.message.payload && p.message.payload.user;
      if (direct && direct.display_id) return direct.display_id;
      const found = scanProps(p, 0, new Set());
      if (found) return found;
    }
    return '';
  }

  function tag() {
    document.querySelectorAll(NAME_SEL).forEach((el) => {
      const name = el.textContent;
      if (el.dataset.tqbName === name && el.hasAttribute('data-tqb-user')) return; // rows get recycled
      el.dataset.tqbName = name;
      el.setAttribute('data-tqb-user', (usernameOf(el) || '').toLowerCase());
    });
  }

  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    setTimeout(() => { queued = false; if (document.querySelector(NAME_SEL)) tag(); }, 150);
  }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
})();
