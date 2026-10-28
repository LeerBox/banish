// One-time setup for automatic Chrome Web Store publishing.
//   node scripts/cws-auth.mjs <oauth-client.json>
// <oauth-client.json> is the "Desktop app" OAuth client downloaded from Google Cloud Console.
// Prints a Google sign-in link; after you press Allow, it stores CWS_CLIENT_ID, CWS_CLIENT_SECRET
// and CWS_REFRESH_TOKEN as GitHub Actions secrets of LeerBox/banish (via the gh CLI). Secrets are never printed.
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';

const REPO = 'LeerBox/banish';
const SCOPE = 'https://www.googleapis.com/auth/chromewebstore';

const file = process.argv[2];
if (!file) { console.error('Usage: node scripts/cws-auth.mjs <oauth-client.json>'); process.exit(2); }
const cfg = JSON.parse(readFileSync(file, 'utf8'));
const { client_id: clientId, client_secret: clientSecret } = cfg.installed || cfg.web || {};
if (!clientId || !clientSecret) { console.error('That file is not an OAuth client JSON.'); process.exit(2); }

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const code = url.searchParams.get('code');
  if (!code) { res.writeHead(400).end(url.searchParams.get('error') || 'No code'); return; }
  try {
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirect, grant_type: 'authorization_code' }),
    });
    const tok = await r.json();
    if (!tok.refresh_token) throw new Error(tok.error_description || tok.error || 'No refresh token returned');
    for (const [name, value] of [['CWS_CLIENT_ID', clientId], ['CWS_CLIENT_SECRET', clientSecret], ['CWS_REFRESH_TOKEN', tok.refresh_token]]) {
      const out = spawnSync('gh', ['secret', 'set', name, '-R', REPO], { input: value, encoding: 'utf8' });
      if (out.status !== 0) throw new Error(`Saving ${name} failed: ${out.stderr}`);
      console.log(`Saved GitHub secret ${name}`);
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      .end('<h2 style="font-family:system-ui">Banish: automatic publishing is set up. You can close this tab.</h2>');
    console.log('DONE');
  } catch (e) {
    res.writeHead(500).end('Setup failed: ' + e.message);
    console.error('FAILED', e.message);
    process.exitCode = 1;
  } finally {
    server.close();
  }
});

let redirect;
server.listen(0, '127.0.0.1', () => {
  redirect = `http://127.0.0.1:${server.address().port}`;
  const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  auth.search = new URLSearchParams({ client_id: clientId, redirect_uri: redirect, response_type: 'code', scope: SCOPE, access_type: 'offline', prompt: 'consent' });
  console.log('Opening Google in your browser. If nothing opens, visit:\n' + auth.toString());
  const opener = process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', auth.toString().replace(/&/g, '^&')]]
    : [process.platform === 'darwin' ? 'open' : 'xdg-open', [auth.toString()]];
  spawnSync(opener[0], opener[1], { stdio: 'ignore', shell: false });
});
