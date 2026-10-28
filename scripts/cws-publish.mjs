// Uploads a package to the Chrome Web Store and submits it for review.
//   node scripts/cws-publish.mjs dist/banish-vX.Y.Z.zip
// Needs CWS_CLIENT_ID, CWS_CLIENT_SECRET, CWS_REFRESH_TOKEN and CWS_EXTENSION_ID in the environment
// (GitHub Actions secrets; set them once with scripts/cws-auth.mjs).
import { readFileSync } from 'node:fs';

const { CWS_CLIENT_ID, CWS_CLIENT_SECRET, CWS_REFRESH_TOKEN, CWS_EXTENSION_ID } = process.env;
const zip = process.argv[2];
if (!zip || !CWS_CLIENT_ID || !CWS_CLIENT_SECRET || !CWS_REFRESH_TOKEN || !CWS_EXTENSION_ID) {
  console.error('Usage: node scripts/cws-publish.mjs <zip>  (with CWS_* variables set)');
  process.exit(2);
}

async function json(res, step) {
  const body = await res.text();
  let data;
  try { data = JSON.parse(body); } catch { data = { raw: body }; }
  if (!res.ok) throw new Error(`${step} failed (${res.status}): ${body.slice(0, 500)}`);
  return data;
}

const token = (await json(await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    client_id: CWS_CLIENT_ID,
    client_secret: CWS_CLIENT_SECRET,
    refresh_token: CWS_REFRESH_TOKEN,
    grant_type: 'refresh_token',
  }),
}), 'Getting an access token')).access_token;

const auth = { Authorization: `Bearer ${token}`, 'x-goog-api-version': '2' };
const item = `https://www.googleapis.com/chromewebstore/v1.1/items/${CWS_EXTENSION_ID}`;

const upload = await json(await fetch(`https://www.googleapis.com/upload/chromewebstore/v1.1/items/${CWS_EXTENSION_ID}`, {
  method: 'PUT',
  headers: auth,
  body: readFileSync(zip),
}), 'Uploading the package');
console.log('Upload:', upload.uploadState, JSON.stringify(upload.itemError || ''));
if (upload.uploadState !== 'SUCCESS') {
  console.error('::error::Chrome Web Store rejected the upload:', JSON.stringify(upload.itemError || upload));
  process.exit(1);
}

const publish = await json(await fetch(`${item}/publish`, { method: 'POST', headers: auth }), 'Submitting for review');
console.log('Publish:', JSON.stringify(publish.status), publish.statusDetail ? JSON.stringify(publish.statusDetail) : '');
const ok = (publish.status || []).every((s) => ['OK', 'ITEM_PENDING_REVIEW'].includes(s));
if (!ok) {
  console.error('::error::Chrome Web Store did not accept the submission:', JSON.stringify(publish));
  process.exit(1);
}
console.log('Submitted to the Chrome Web Store for review.');
