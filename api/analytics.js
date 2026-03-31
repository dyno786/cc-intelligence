import { getValidToken } from './auth/status.js';

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  try {
    const { token, newCookies } = await getValidToken(req);
    if (newCookies) res.setHeader('Set-Cookie', newCookies);
    if (!token) return res.status(401).json({ error: 'Not authenticated' });

    const propertyId = req.query.propertyId || '403507004';
    const endDate = 'today';
    const startDate = '28daysAgo';

    const r = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: 'pagePath' }],
        metrics: [
          { name: 'sessions' },
          { name: 'bounceRate' },
          { name: 'averageSessionDuration' },
          { name: 'screenPageViews' },
        ],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: 20,
      }),
    });

    const data = await r.json();
    if (data.error) throw new Error(data.error.message);

    // Also get totals
    const totalsRes = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dateRanges: [{ startDate: '7daysAgo', endDate }],
        metrics: [
          { name: 'sessions' },
          { name: 'bounceRate' },
          { name: 'newUsers' },
          { name: 'averageSessionDuration' },
        ],
      }),
    });
    const totalsData = await totalsRes.json();
    const totals = totalsData.rows?.[0]?.metricValues || [];

    const topPages = (data.rows || []).map(row => ({
      page: row.dimensionValues[0].value,
      sessions: parseInt(row.metricValues[0].value),
      bounceRate: parseFloat(row.metricValues[1].value).toFixed(1),
    }));

    res.json({
      sessions: parseInt(totals[0]?.value || 0),
      bounceRate: parseFloat(totals[1]?.value || 0).toFixed(1),
      newUsers: parseInt(totals[2]?.value || 0),
      avgSessionDuration: parseFloat(totals[3]?.value || 0).toFixed(0),
      topPages,
    });

  } catch (err) {
    console.error('GA4 error:', err.message);
    res.status(500).json({ error: err.message });
  }
}
