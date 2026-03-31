export default async function handler(req, res) {
  const { code, error } = req.query;

  if (error) {
    return res.redirect('/?error=' + encodeURIComponent(error));
  }
  if (!code) {
    return res.redirect('/?error=no_code');
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.REDIRECT_URI || `https://${req.headers.host}/api/auth/callback`;

  try {
    // Exchange code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    const tokens = await tokenRes.json();
    if (tokens.error) throw new Error(tokens.error_description || tokens.error);

    const expiry = Date.now() + (tokens.expires_in * 1000);

    // Store tokens in secure cookies (7 day expiry for refresh token)
    const cookieOpts = 'Path=/; HttpOnly; Secure; SameSite=Lax';
    const cookies = [
      `cc_access_token=${tokens.access_token}; ${cookieOpts}; Max-Age=${tokens.expires_in}`,
      `cc_token_expiry=${expiry}; ${cookieOpts}; Max-Age=86400`,
    ];
    if (tokens.refresh_token) {
      cookies.push(`cc_refresh_token=${tokens.refresh_token}; ${cookieOpts}; Max-Age=${7 * 24 * 3600}`);
    }
    res.setHeader('Set-Cookie', cookies);
    res.redirect('/');
  } catch (err) {
    console.error('OAuth callback error:', err);
    res.redirect('/?error=' + encodeURIComponent(err.message));
  }
}
