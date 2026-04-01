import { getValidToken } from './auth/status.js';
export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const { token, newCookies } = await getValidToken(req);
    if (newCookies) res.setHeader('Set-Cookie', newCookies);
    if (!token) return res.json({ error: 'Not authenticated — please log in first' });

    const devToken = process.env.GOOGLE_ADS_DEV_TOKEN || '';
    const managerId = '7490010943';
    const clientId  = '3934493272';
    const version   = 'v19';

    // Step 1: list accessible customers
    const listR = await fetch(`https://googleads.googleapis.com/${version}/customers:listAccessibleCustomers`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'developer-token': devToken,
        'login-customer-id': managerId,
      }
    });
    const listText = await listR.text();

    // Step 2: try a simple campaign query
    const queryR = await fetch(
      `https://googleads.googleapis.com/${version}/customers/${clientId}/googleAds:search`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'developer-token': devToken,
          'login-customer-id': managerId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: 'SELECT campaign.name FROM campaign LIMIT 3' }),
      }
    );
    const queryText = await queryR.text();

    res.json({
      tokenPreview: token ? token.substring(0,20)+'...' : 'none',
      devTokenPresent: !!devToken,
      devTokenPreview: devToken ? devToken.substring(0,8)+'...' : 'none',
      managerId, clientId, version,
      listAccessible: { status: listR.status, body: listText.substring(0, 1000) },
      campaignQuery: { status: queryR.status, body: queryText.substring(0, 1000) },
    });
  } catch(err) {
    res.json({ error: err.message });
  }
}
