import { getValidToken } from './auth/status.js';
export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const { token, newCookies } = await getValidToken(req);
    if (newCookies) res.setHeader('Set-Cookie', newCookies);
    if (!token) return res.json({ error: 'Not authenticated' });

    const devToken = process.env.GOOGLE_ADS_DEV_TOKEN || '';

    // Try v19 search with absolutely minimal headers
    const r1 = await fetch(
      'https://googleads.googleapis.com/v19/customers:listAccessibleCustomers',
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'developer-token': devToken,
        }
      }
    );
    const b1 = await r1.text();

    // Try v19 search endpoint
    const r2 = await fetch(
      'https://googleads.googleapis.com/v19/customers/3934493272/googleAds:search',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'developer-token': devToken,
          'login-customer-id': '7490010943',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: 'SELECT campaign.name FROM campaign LIMIT 1' }),
      }
    );
    const b2 = await r2.text();

    // Parse and return full response
    let parsed1, parsed2;
    try { parsed1 = JSON.parse(b1); } catch(e) { parsed1 = { raw: b1 }; }
    try { parsed2 = JSON.parse(b2); } catch(e) { parsed2 = { raw: b2.substring(0, 2000) }; }

    res.json({
      devToken: devToken.length + ' chars, starts:' + devToken.substring(0,4) + ' ends:' + devToken.slice(-4),
      listCustomers: { status: r1.status, response: parsed1 },
      campaignSearch: { status: r2.status, response: parsed2 },
    });

  } catch(err) {
    res.json({ error: err.message, stack: err.stack?.substring(0,500) });
  }
}
