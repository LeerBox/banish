// Banish — page-context bridge (runs in TikTok's own JS world).
// Requests sent from here go through TikTok's web SDK, which signs them like the site's own requests.
// The content script asks for a block via window.postMessage and gets the result back the same way.
(() => {
  'use strict';

  function post(url, body) {
    return new Promise((resolve, reject) => {
      const x = new XMLHttpRequest();
      x.open('POST', url);
      x.withCredentials = true;
      x.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
      x.onload = () => resolve({ status: x.status, text: x.responseText });
      x.onerror = () => reject(new Error('network error'));
      x.ontimeout = () => reject(new Error('request timed out'));
      x.timeout = 15000;
      x.send(body || '');
    });
  }

  window.addEventListener('message', async (e) => {
    if (e.source !== window || e.origin !== location.origin) return;
    const d = e.data;
    if (!d || d.banish !== 'block-req' || !d.userId || !d.secUid) return;

    const params = new URLSearchParams({
      aid: '1988',
      app_name: 'tiktok_web',
      device_platform: 'web_pc',
      block_type: '1',
      source: '0',
      user_id: d.userId,
      sec_user_id: d.secUid,
    });
    let result;
    try {
      const res = await post(`/api/user/block/?${params}`);
      let json = null;
      try { json = JSON.parse(res.text); } catch (_) { /* not JSON */ }
      result = {
        ok: res.status === 200 && !!json && Number(json.status_code) === 0,
        status: res.status,
        code: json ? json.status_code : undefined,
        msg: json ? (json.status_msg || json.message || '') : res.text.slice(0, 120),
      };
    } catch (err) {
      result = { ok: false, msg: err.message };
    }
    window.postMessage({ banish: 'block-res', id: d.id, ...result }, location.origin);
  });
})();
