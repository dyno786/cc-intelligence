export default function handler(req, res) {
  const expire = 'Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0';
  res.setHeader('Set-Cookie', [
    `cc_access_token=; ${expire}`,
    `cc_refresh_token=; ${expire}`,
    `cc_token_expiry=; ${expire}`,
  ]);
  res.json({ ok: true });
}
