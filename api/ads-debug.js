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

    // Test 1: v19 list accessible customers
    const t1 = await fetch(`https://googleads.googleapis.com/v19/customers:listAccessibleCustomers`, {
      headers: { 'Authorization': `Bearer ${token}`, 'developer-token': devToken }
    });
    const t1text = await t1.text();

    // Test 2: v20 list accessible customers  
    const t2 = await fetch(`https://googleads.googleapis.com/v20/customers:listAccessibleCustomers`, {
      headers: { 'Authorization': `Bearer ${token}`, 'developer-token': devToken }
    });
    const t2text = await t2.text();

    // Test 3: Check token scopes via Google tokeninfo
    const t3 = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${token}`);
    const t3text = await t3.text();

    // Test 4: v19 campaign query with correct headers
    const t4 = await fetch(`https://googleads.googleapis.com/v19/customers/${clientId}/googleAds:search`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'developer-token': devToken,
        'login-customer-id': managerId,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({ query: 'SELECT campaign.name FROM campaign LIMIT 3' }),
    });
    const t4text = await t4.text();

    res.json({
      tokenSnippet: token.substring(0,30)+'...',
      devTokenPresent: !!devToken,
      devTokenLength: devToken.length,
      t1_v19_list: { status: t1.status, body: t1text.substring(0, 500) },
      t2_v20_list: { status: t2.status, body: t2text.substring(0, 500) },
      t3_tokeninfo: { status: t3.status, body: t3text.substring(0, 500) },
      t4_campaign_query: { status: t4.status, body: t4text.substring(0, 500) },
    });
  } catch(err) {
    res.json({ error: err.message, stack: err.stack?.substring(0,300) });
  }
}
