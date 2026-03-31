import { parseCookies } from './status.js';

export default async function handler(req, res) {
  const cookies = parseCookies(req.headers.cookie || '');
  const token = cookies.cc_access_token || cookies.cc_refresh_token;

  // Revoke the Google token so reconnect forces fresh account selection
  if (token) {
    try {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${token}`, { method: 'POST' });
    } catch(e) { /* ignore revoke errors */ }
  }

  const expire = 'Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0';
  res.setHeader('Set-Cookie', [
    `cc_access_token=; ${expire}`,
    `cc_refresh_token=; ${expire}`,
    `cc_token_expiry=; ${expire}`,
  ]);
  res.json({ ok: true });
}
