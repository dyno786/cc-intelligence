import { getValidToken, parseCookies } from './auth/status.js';

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const { token, newCookies } = await getValidToken(req);
    if (newCookies) res.setHeader('Set-Cookie', newCookies);
    if (!token) return res.status(401).json({ error: 'Not authenticated' });

    const siteUrl = req.query.site || 'https://www.cchairandbeauty.com';
    const endDate = new Date().toISOString().split('T')[0];
    const startDate = new Date(Date.now() - 28 * 24 * 3600 * 1000).toISOString().split('T')[0];
    const last7Start = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString().split('T')[0];

    // Fetch queries (last 28 days for trends)
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

    // Calculate totals from last 7 days chart
    const chartRows = chartData.rows || [];
    const totalClicks = chartRows.reduce((s, r) => s + (r.clicks || 0), 0);
    const totalImpressions = chartRows.reduce((s, r) => s + (r.impressions || 0), 0);
    const avgPosition = chartRows.length ? chartRows.reduce((s, r) => s + (r.position || 0), 0) / chartRows.length : 0;

    // Process queries for opportunities
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
      dateRange: { startDate, endDate },
    });

  } catch (err) {
    console.error('Search Console error:', err.message);
    res.status(500).json({ error: err.message });
  }
}
