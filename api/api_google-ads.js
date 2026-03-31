import { getValidToken } from './auth/status.js';

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  try {
    const { token, newCookies } = await getValidToken(req);
    if (newCookies) res.setHeader('Set-Cookie', newCookies);
    if (!token) return res.status(401).json({ error: 'Not authenticated' });

    const customerId = (req.query.customerId || '3934493272').replace(/-/g, '');
    const devToken = process.env.GOOGLE_ADS_DEV_TOKEN || '';

    // Google Ads API uses GAQL query language
    const query = `
      SELECT
        campaign.name,
        campaign.status,
        metrics.cost_micros,
        metrics.clicks,
        metrics.impressions,
        metrics.conversions,
        metrics.conversions_value,
        metrics.ctr,
        metrics.average_cpc
      FROM campaign
      WHERE segments.date DURING LAST_30_DAYS
        AND campaign.status = 'ENABLED'
      ORDER BY metrics.cost_micros DESC
      LIMIT 20
    `;

    const r = await fetch(`https://googleads.googleapis.com/v17/customers/${customerId}/googleAds:search`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'developer-token': devToken,
        'Content-Type': 'application/json',
        'login-customer-id': customerId,
      },
      body: JSON.stringify({ query: query.trim() }),
    });

    const data = await r.json();

    if (data.error) {
      // Ads API requires a developer token - return mock if not set up
      if (!devToken) {
        return res.json({
          campaigns: [],
          totalSpend: 0, totalClicks: 0, totalConv: 0,
          note: 'Google Ads developer token not configured. Add GOOGLE_ADS_DEV_TOKEN to Vercel environment variables.',
        });
      }
      throw new Error(data.error.message || JSON.stringify(data.error));
    }

    const campaigns = (data.results || []).map(row => {
      const c = row.campaign;
      const m = row.metrics;
      const cost = (m.costMicros || 0) / 1000000;
      const conv = parseFloat(m.conversions || 0);
      return {
        name: c.name,
        status: c.status,
        cost,
        clicks: parseInt(m.clicks || 0),
        impressions: parseInt(m.impressions || 0),
        conversions: conv,
        conversionValue: parseFloat(m.conversionsValue || 0),
        ctr: parseFloat(m.ctr || 0) * 100,
        avgCpc: (m.averageCpc || 0) / 1000000,
        roas: cost > 0 ? parseFloat(m.conversionsValue || 0) / cost : 0,
      };
    });

    const totalSpend = campaigns.reduce((s, c) => s + c.cost, 0);
    const totalClicks = campaigns.reduce((s, c) => s + c.clicks, 0);
    const totalConv = campaigns.reduce((s, c) => s + c.conversions, 0);
    const totalConvValue = campaigns.reduce((s, c) => s + c.conversionValue, 0);

    res.json({ campaigns, totalSpend, totalClicks, totalConv, totalConvValue });

  } catch (err) {
    console.error('Google Ads error:', err.message);
    res.status(500).json({ error: err.message });
  }
}
