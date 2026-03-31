async function getValidToken(req) {
  const cookies = parseCookies(req.headers.cookie || '');
  const accessToken = cookies.cc_access_token;
  const refreshToken = cookies.cc_refresh_token;
  const expiry = parseInt(cookies.cc_token_expiry || '0');

  // Token still valid
  if (accessToken && Date.now() < expiry - 60000) {
    return { token: accessToken, newCookies: null };
  }

  // Try to refresh
  if (!refreshToken) return { token: null, newCookies: null };

  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  const tokens = await r.json();
  if (tokens.error || !tokens.access_token) return { token: null, newCookies: null };

  const newExpiry = Date.now() + (tokens.expires_in * 1000);
  const cookieOpts = 'Path=/; HttpOnly; Secure; SameSite=Lax';
  const newCookies = [
    `cc_access_token=${tokens.access_token}; ${cookieOpts}; Max-Age=${tokens.expires_in}`,
    `cc_token_expiry=${newExpiry}; ${cookieOpts}; Max-Age=86400`,
  ];

  return { token: tokens.access_token, newCookies };
}

function parseCookies(str) {
  return str.split(';').reduce((acc, part) => {
    const [k, ...v] = part.trim().split('=');
    if (k) acc[k.trim()] = decodeURIComponent(v.join('='));
    return acc;
  }, {});
}

export default async function handler(req, res) {
  try {
    const { token, newCookies } = await getValidToken(req);
    if (newCookies) res.setHeader('Set-Cookie', newCookies);
    res.json({ authenticated: !!token });
  } catch(e) {
    res.json({ authenticated: false });
  }
}

export { getValidToken, parseCookies };
