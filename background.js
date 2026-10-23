// Banish — fallback: run the block flow in a background tab
// when the hidden in-page frame can't complete it.
const pending = new Map(); // tabId -> { resolve, timer }

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'tqb-block-in-tab') {
    const id = Math.random().toString(36).slice(2);
    const url = `https://www.tiktok.com/@${encodeURIComponent(msg.username)}?tqb_block=${id}`;
    chrome.tabs.create({ url, active: false }, (tab) => {
      const timer = setTimeout(() => finish(tab.id, { ok: false, error: 'timeout' }), 30000);
      pending.set(tab.id, { resolve: sendResponse, timer });
    });
    return true; // async response
  }
  if (msg.type === 'tqb-worker-result' && sender.tab) {
    finish(sender.tab.id, { ok: msg.ok, already: msg.already, error: msg.error });
  }
});

function finish(tabId, result) {
  const p = pending.get(tabId);
  if (!p) return;
  pending.delete(tabId);
  clearTimeout(p.timer);
  chrome.tabs.remove(tabId).catch(() => {});
  p.resolve(result);
}
