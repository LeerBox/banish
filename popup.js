const DEFAULTS = { notInterested: true, confirmFirst: false, autoSkip: true, showInComments: true, dimBlocked: true };

chrome.storage.sync.get(DEFAULTS, (s) => {
  for (const key of Object.keys(DEFAULTS)) {
    const box = document.getElementById(key);
    box.checked = !!s[key];
    box.addEventListener('change', () => chrome.storage.sync.set({ [key]: box.checked }));
  }
});

function timeAgo(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function render(blocked) {
  const entries = Object.entries(blocked).sort((a, b) => b[1].ts - a[1].ts);
  document.getElementById('count').textContent = entries.length;
  const list = document.getElementById('list');
  list.replaceChildren();
  if (!entries.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'Nobody yet. Look for the ⊘ button on TikTok.';
    list.append(li);
    return;
  }
  for (const [user, info] of entries.slice(0, 100)) {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = `https://www.tiktok.com/@${encodeURIComponent(user)}`;
    a.target = '_blank';
    a.textContent = `@${user}`;
    const t = document.createElement('time');
    t.textContent = timeAgo(info.ts);
    li.append(a, t);
    list.append(li);
  }
}

chrome.storage.local.get({ blocked: {} }, (s) => render(s.blocked));
chrome.storage.onChanged.addListener((c, area) => { if (area === 'local' && c.blocked) render(c.blocked.newValue || {}); });

document.getElementById('clear').addEventListener('click', () => {
  if (confirm('Clear the local list? (Accounts stay blocked on TikTok.)')) chrome.storage.local.set({ blocked: {} });
});
