// Banish — fallback: run the block flow in a background tab
// when the hidden in-page frame can't complete it.
const pending = new Map(); // tabId -> { id, resolve, timer }

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'tqb-block-in-tab') {
    const id = Math.random().toString(36).slice(2);
    const url = `https://www.tiktok.com/@${encodeURIComponent(msg.username)}?tqb_block=${id}`;
    chrome.tabs.create({ url, active: false }, (tab) => {
      const timer = setTimeout(() => finish(tab.id, { ok: false, error: 'Background tab timed out' }), 40000);
      pending.set(tab.id, { id, resolve: sendResponse, timer });
    });
    return true; // async response
  }
  // The tab's content script asks whether it is a job (TikTok may have stripped the URL param).
  if (msg.type === 'tqb-who-am-i' && sender.tab) {
    const job = pending.get(sender.tab.id);
    sendResponse(job ? { id: job.id } : {});
    return;
  }
  if (msg.type === 'tqb-worker-result' && sender.tab) {
    finish(sender.tab.id, { ok: msg.ok, already: msg.already, verified: msg.verified, error: msg.error });
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
