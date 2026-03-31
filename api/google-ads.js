import { getValidToken } from './auth/status.js';

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  // Prevent caching
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  
  try {
    const { token, newCookies } = await getValidToken(req);
    if (newCookies) res.setHeader('Set-Cookie', newCookies);
    if (!token) return res.status(401).json({ error: 'Not authenticated' });

    const devToken = process.env.GOOGLE_ADS_DEV_TOKEN || '';
    if (!devToken) {
      return res.json({
        campaigns: [], totalSpend: 0, totalClicks: 0, totalConv: 0,
        note: 'Add GOOGLE_ADS_DEV_TOKEN to Vercel environment variables.',
      });
    }

    // IMPORTANT: URL uses client account, header uses manager account
    const managerCustomerId = '7490010943';  // 749-001-0943 Manager
    const clientCustomerId = '3934493272';   // 393-449-3272 Regular account

    const query = `SELECT campaign.name, campaign.status, metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions, metrics.conversions_value, metrics.ctr, metrics.average_cpc FROM campaign WHERE segments.date DURING LAST_30_DAYS AND campaign.status = 'ENABLED' ORDER BY metrics.cost_micros DESC LIMIT 20`;

    console.log('Calling Google Ads API for customer:', clientCustomerId, 'via manager:', managerCustomerId);

    const r = await fetch(`https://googleads.googleapis.com/v17/customers/${clientCustomerId}/googleAds:search`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'developer-token': devToken,
        'Content-Type': 'application/json',
        'login-customer-id': managerCustomerId,
        'Cache-Control': 'no-cache',
      },
      body: JSON.stringify({ query }),
    });

    const rawText = await r.text();
    const contentType = r.headers.get('content-type') || '';

    console.log('Google Ads status:', r.status, 'content-type:', contentType);
    console.log('Google Ads response preview:', rawText.substring(0, 500));

    if (contentType.includes('text/html') || rawText.trim().startsWith('<!')) {
      return res.json({
        campaigns: [], totalSpend: 0, totalClicks: 0, totalConv: 0,
        debugError: 'HTML response',
        httpStatus: r.status,
        preview: rawText.substring(0, 500),
      });
    }

    let data;
    try { data = JSON.parse(rawText); }
    catch(e) { return res.status(500).json({ error: 'Parse error: ' + rawText.substring(0, 200) }); }

    if (data.error) {
      console.error('Google Ads API error:', JSON.stringify(data.error));
      throw new Error(data.error.message || JSON.stringify(data.error));
    }

    const campaigns = (data.results || []).map(row => {
      const c = row.campaign;
      const m = row.metrics;
      const cost = (m.costMicros || 0) / 1000000;
      const conv = parseFloat(m.conversions || 0);
      return {
        name: c.name, status: c.status, cost,
        clicks: parseInt(m.clicks || 0),
        impressions: parseInt(m.impressions || 0),
        conversions: conv,
        conversionValue: parseFloat(m.conversionsValue || 0),
        ctr: parseFloat(m.ctr || 0) * 100,
        avgCpc: (m.averageCpc || 0) / 1000000,
        roas: cost > 0 ? parseFloat(m.conversionsValue || 0) / cost : 0,
      };
    });

    res.json({
      campaigns,
      totalSpend: campaigns.reduce((s,c)=>s+c.cost,0),
      totalClicks: campaigns.reduce((s,c)=>s+c.clicks,0),
      totalConv: campaigns.reduce((s,c)=>s+c.conversions,0),
      totalConvValue: campaigns.reduce((s,c)=>s+c.conversionValue,0),
    });

  } catch (err) {
    console.error('Google Ads error:', err.message);
    res.status(500).json({ error: err.message });
  }
}
