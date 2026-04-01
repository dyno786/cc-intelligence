import { getValidToken } from './auth/status.js';
export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const { token, newCookies } = await getValidToken(req);
    if (newCookies) res.setHeader('Set-Cookie', newCookies);
    if (!token) return res.json({ error: 'Not authenticated — please log in first' });

    const devToken = process.env.GOOGLE_ADS_DEV_TOKEN || '';

    // Test A: Check token scopes
    const scopeR = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${token}`);
    const scopeData = await scopeR.json();

    // Test B: Raw headers being sent
    const managerId = '7490010943';
    const clientId  = '3934493272';
    const url = `https://googleads.googleapis.com/v19/customers:listAccessibleCustomers`;
    
    const hdrs = {
      'Authorization': `Bearer ${token}`,
      'developer-token': devToken,
      'login-customer-id': managerId,
      'Content-Type': 'application/json',
    };

    // Test C: Hit the endpoint and get ALL response headers
    const r = await fetch(url, { headers: hdrs });
    const responseHeaders = {};
    r.headers.forEach((v, k) => { responseHeaders[k] = v; });
    const body = await r.text();

    // Test D: Try without login-customer-id header
    const r2 = await fetch(url, { 
      headers: {
        'Authorization': `Bearer ${token}`,
        'developer-token': devToken,
      }
    });
    const body2 = await r2.text();

    res.json({
      tokenScopes: scopeData.scope || scopeData.error || 'no scope field',
      tokenEmail: scopeData.email || 'not in token',
      devTokenLength: devToken.length,
      devTokenStart: devToken.substring(0,4),
      devTokenEnd: devToken.substring(devToken.length-4),
      urlCalled: url,
      withManagerId: { status: r.status, headers: responseHeaders, body: body.substring(0,800) },
      withoutManagerId: { status: r2.status, body: body2.substring(0,400) },
    });
  } catch(err) {
    res.json({ error: err.message });
  }
}
