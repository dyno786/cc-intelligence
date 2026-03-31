import { getValidToken } from './auth/status.js';

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  try {
    const { token, newCookies } = await getValidToken(req);
    if (newCookies) res.setHeader('Set-Cookie', newCookies);
    if (!token) return res.status(401).json({ error: 'Not authenticated' });

    // Domain property uses sc-domain: prefix
    // URL prefix property uses the full URL
    // We try domain property first, fall back to URL prefix
    const rawSite = req.query.site || 'cchairandbeauty.com';
    
    // Strip protocol/www to get bare domain
    const domain = rawSite.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
    
    // Try sc-domain: format first (domain property)
    const siteUrl = `sc-domain:${domain}`;

    const endDate = new Date().toISOString().split('T')[0];
    const startDate = new Date(Date.now() - 28 * 24 * 3600 * 1000).toISOString().split('T')[0];
    const last7Start = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString().split('T')[0];

    const [queriesRes, chartRes] = await Promise.all([
      fetch(`https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startDate, endDate,
          dimensions: ['query'],
          rowLimit: 1000,
          dataState: 'all',
        }),
      }),
      fetch(`https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startDate: last7Start, endDate,
          dimensions: ['date'],
          rowLimit: 7,
        }),
      }),
    ]);

    const queriesData = await queriesRes.json();
    const chartData = await chartRes.json();

    if (queriesData.error) throw new Error(queriesData.error.message);

    const rows = queriesData.rows || [];
    const chartRows = chartData.rows || [];
    
    const totalClicks = chartRows.reduce((s, r) => s + (r.clicks || 0), 0);
    const totalImpressions = chartRows.reduce((s, r) => s + (r.impressions || 0), 0);
    const avgPosition = chartRows.length ? chartRows.reduce((s, r) => s + (r.position || 0), 0) / chartRows.length : 0;

    const queries = rows.map(r => ({
      query: r.keys[0],
      clicks: r.clicks,
      impressions: r.impressions,
      ctr: (r.ctr || 0) * 100,
      position: r.position,
    }));

    const lowCTR = queries
      .filter(q => q.impressions > 200 && q.ctr < 3)
      .sort((a, b) => b.impressions - a.impressions)
      .slice(0, 25);

    const nearPage1 = queries
      .filter(q => q.position >= 7 && q.position <= 15 && q.impressions > 100)
      .sort((a, b) => b.impressions - a.impressions)
      .slice(0, 20);

    const topByClicks = queries
      .sort((a, b) => b.clicks - a.clicks)
      .slice(0, 10);

    res.json({
      totalClicks, totalImpressions, avgPosition,
      lowCTR, nearPage1, topByClicks,
      siteUrl,
      dateRange: { startDate, endDate },
    });

  } catch (err) {
    console.error('Search Console error:', err.message);
    res.status(500).json({ error: err.message });
  }
}
