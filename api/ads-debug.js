import { getValidToken } from './auth/status.js';
import https from 'https';
export const config = { maxDuration: 30 };

function httpsGet(url, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'GET',
      headers,
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    req.end();
  });
}

function httpsPost(url, headers, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const bodyStr = JSON.stringify(body);
    const opts = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'POST',
      headers: { ...headers, 'Content-Length': Buffer.byteLength(bodyStr) },
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const { token, newCookies } = await getValidToken(req);
    if (newCookies) res.setHeader('Set-Cookie', newCookies);
    if (!token) return res.json({ error: 'Not authenticated' });

    const devToken = process.env.GOOGLE_ADS_DEV_TOKEN || '';

    // Test 1: fetch (current method - failing)
    const f1 = await fetch('https://googleads.googleapis.com/v19/customers:listAccessibleCustomers', {
      headers: { 'Authorization': `Bearer ${token}`, 'developer-token': devToken }
    });
    const fb1 = await f1.text();

    // Test 2: Node https module (different DNS/TCP stack)
    const h1 = await httpsGet('https://googleads.googleapis.com/v19/customers:listAccessibleCustomers', {
      'Authorization': `Bearer ${token}`,
      'developer-token': devToken,
    });

    // Test 3: Node https POST for campaign query
    const h2 = await httpsPost(
      'https://googleads.googleapis.com/v19/customers/3934493272/googleAds:search',
      {
        'Authorization': `Bearer ${token}`,
        'developer-token': devToken,
        'login-customer-id': '7490010943',
        'Content-Type': 'application/json',
      },
      { query: 'SELECT campaign.name FROM campaign LIMIT 1' }
    );

    let p1, p2;
    try { p1 = JSON.parse(h1.body); } catch(e) { p1 = h1.body.substring(0, 300); }
    try { p2 = JSON.parse(h2.body); } catch(e) { p2 = h2.body.substring(0, 300); }

    res.json({
      fetch_result: { status: f1.status, bodyStart: fb1.substring(0, 150) },
      https_list: { status: h1.status, server: h1.headers.server, result: p1 },
      https_search: { status: h2.status, server: h2.headers.server, result: p2 },
    });

  } catch(err) {
    res.json({ error: err.message, stack: err.stack?.substring(0,400) });
  }
}
