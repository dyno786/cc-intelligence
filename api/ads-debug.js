import { getValidToken } from './auth/status.js';
export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const { token, newCookies } = await getValidToken(req);
    if (newCookies) res.setHeader('Set-Cookie', newCookies);
    if (!token) return res.json({ error: 'Not authenticated' });

    const devToken = process.env.GOOGLE_ADS_DEV_TOKEN || '';
    const hdrs = {
      'Authorization': `Bearer ${token}`,
      'developer-token': devToken,
      'Content-Type': 'application/json',
    };

    // DNS check - what IP does googleads.googleapis.com resolve to?
    const dnsR = await fetch('https://dns.google/resolve?name=googleads.googleapis.com&type=A');
    const dnsData = await dnsR.json();

    // Try 1: standard URL
    const r1 = await fetch('https://googleads.googleapis.com/v19/customers:listAccessibleCustomers', { headers: hdrs });
    const b1 = await r1.text();

    // Try 2: with Host header override pointing to googleapis.com
    const r2 = await fetch('https://googleads.googleapis.com/v19/customers:listAccessibleCustomers', {
      headers: { ...hdrs, 'Host': 'googleads.googleapis.com' }
    });
    const b2 = await r2.text();

    // Try 3: Search Console works - test similar googleapis call
    const r3 = await fetch('https://analyticsdata.googleapis.com/v1beta/properties/403507004:runReport', {
      method: 'POST',
      headers: hdrs,
      body: JSON.stringify({ dateRanges: [{ startDate: '7daysAgo', endDate: 'today' }], metrics: [{ name: 'sessions' }] })
    });
    const b3 = await r3.text();

    res.json({
      dns_googleads: dnsData?.Answer?.map(a => a.data) || 'no answer',
      try1_googleads: { status: r1.status, bodyStart: b1.substring(0, 200) },
      try2_with_host: { status: r2.status, bodyStart: b2.substring(0, 200) },
      try3_analytics: { status: r3.status, bodyStart: b3.substring(0, 200) },
    });
  } catch(err) {
    res.json({ error: err.message });
  }
}
