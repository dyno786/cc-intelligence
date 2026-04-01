import { getValidToken } from './auth/status.js';
export const config = { maxDuration: 30, regions: ['lhr1'] };

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const { token, newCookies } = await getValidToken(req);
    if (newCookies) res.setHeader('Set-Cookie', newCookies);
    if (!token) return res.json({ error: 'Not authenticated — please log in first' });

    const devToken = process.env.GOOGLE_ADS_DEV_TOKEN || '';

    // Check token scopes
    const scopeR = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${token}`);
    const scopeData = await scopeR.json();

    // Test from London region
    const url = `https://googleads.googleapis.com/v19/customers:listAccessibleCustomers`;
    const r = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'developer-token': devToken,
        'Content-Type': 'application/json',
      }
    });
    const responseHeaders = {};
    r.headers.forEach((v, k) => { responseHeaders[k] = v; });
    const body = await r.text();

    // Try campaign query
    const r2 = await fetch(
      `https://googleads.googleapis.com/v19/customers/3934493272/googleAds:search`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'developer-token': devToken,
          'login-customer-id': '7490010943',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: 'SELECT campaign.name FROM campaign LIMIT 3' }),
      }
    );
    const body2 = await r2.text();

    res.json({
      region: process.env.VERCEL_REGION || 'unknown',
      tokenEmail: scopeData.email,
      tokenScopes: scopeData.scope,
      devTokenLength: devToken.length,
      listCustomers: { status: r.status, server: responseHeaders.server, body: body.substring(0, 600) },
      campaignQuery: { status: r2.status, body: body2.substring(0, 600) },
    });
  } catch(err) {
    res.json({ error: err.message });
  }
}
