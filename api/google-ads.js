import { getValidToken } from './auth/status.js';

export const config = { maxDuration: 60, regions: ['lhr1'] };

const MANAGER_ID  = '7490010943';
const CLIENT_ID   = '3934493272';
const ADS_VERSION = 'v19';
const BASE        = `https://googleads.googleapis.com/${ADS_VERSION}/customers/${CLIENT_ID}/googleAds:search`;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

  try {
    const { token, newCookies } = await getValidToken(req);
    if (newCookies) res.setHeader('Set-Cookie', newCookies);
    if (!token) return res.status(401).json({ error: 'Not authenticated' });

    const devToken = process.env.GOOGLE_ADS_DEV_TOKEN || '';
    if (!devToken) {
      return res.json({ campaigns:[], adGroups:[], keywords:[], searchTerms:[],
        devices:[], totalSpend:0, totalClicks:0, totalConv:0,
        note:'Add GOOGLE_ADS_DEV_TOKEN to Vercel environment variables.' });
    }

    const headers = {
      'Authorization': `Bearer ${token}`,
      'developer-token': devToken,
      'Content-Type': 'application/json',
      'login-customer-id': MANAGER_ID,
    };

    // Helper: run a GAQL query
    async function gaql(query, label='') {
      const r = await fetch(BASE, {
        method: 'POST',
        headers,
        body: JSON.stringify({ query }),
      });
      const text = await r.text();
      if (!r.ok) {
        console.error(`GAQL [${label}] ERROR ${r.status}:`, text.substring(0,600));
        return { results: [], _error: { status: r.status, body: text.substring(0,600) } };
      }
      try { return JSON.parse(text); }
      catch(e) { return { results: [] }; }
    }

    // ── 1. CAMPAIGNS ────────────────────────────────────────────
    const campData = await gaql(`
      SELECT campaign.id, campaign.name, campaign.status,
        metrics.cost_micros, metrics.clicks, metrics.impressions,
        metrics.conversions, metrics.conversions_value, metrics.ctr,
        metrics.average_cpc, metrics.search_impression_share,
        metrics.search_top_impression_share
      FROM campaign
      WHERE segments.date DURING LAST_30_DAYS
        AND campaign.status = 'ENABLED'
      ORDER BY metrics.cost_micros DESC
      LIMIT 50
    `);

    const campaigns = (campData.results || []).map(row => {
      const c = row.campaign, m = row.metrics;
      const cost = (m.costMicros || 0) / 1e6;
      const conv = parseFloat(m.conversions || 0);
      return {
        id: c.id, name: c.name, status: c.status, cost,
        clicks: parseInt(m.clicks || 0),
        impressions: parseInt(m.impressions || 0),
        conversions: conv,
        convValue: parseFloat(m.conversionsValue || 0),
        ctr: parseFloat(m.ctr || 0) * 100,
        avgCpc: (m.averageCpc || 0) / 1e6,
        cpa: conv > 0 ? cost / conv : 0,
        roas: cost > 0 ? parseFloat(m.conversionsValue || 0) / cost : 0,
        impressionShare: parseFloat(m.searchImpressionShare || 0) * 100,
        topImprShare: parseFloat(m.searchTopImpressionShare || 0) * 100,
      };
    });

    // ── 2. AD GROUPS ─────────────────────────────────────────────
    const agData = await gaql(`
      SELECT ad_group.id, ad_group.name, ad_group.status,
        campaign.name, campaign.id,
        metrics.cost_micros, metrics.clicks, metrics.impressions,
        metrics.conversions, metrics.conversions_value,
        metrics.ctr, metrics.average_cpc,
        metrics.search_impression_share
      FROM ad_group
      WHERE segments.date DURING LAST_30_DAYS
        AND ad_group.status = 'ENABLED'
        AND campaign.status = 'ENABLED'
      ORDER BY metrics.cost_micros DESC
      LIMIT 100
    `);

    const adGroups = (agData.results || []).map(row => {
      const ag = row.adGroup, c = row.campaign, m = row.metrics;
      const cost = (m.costMicros || 0) / 1e6;
      const conv = parseFloat(m.conversions || 0);
      const cpa  = conv > 0 ? cost / conv : 0;

      // Verdict logic
      let verdict, action;
      if (cost < 1 && conv === 0)     { verdict = 'MONITOR';  action = 'Too little data — watch for another month'; }
      else if (conv === 0 && cost > 10) { verdict = 'PAUSE';    action = `£${cost.toFixed(2)} spent, zero conversions — pause and review keywords`; }
      else if (conv === 0 && cost > 2)  { verdict = 'REVIEW';   action = 'Spending with no conversions — check keywords and landing page'; }
      else if (cpa > 0 && cpa < 3)     { verdict = 'SCALE UP'; action = `CPA £${cpa.toFixed(2)} — excellent. Increase budget 3-5x`; }
      else if (cpa > 0 && cpa < 8)     { verdict = 'KEEP';     action = `CPA £${cpa.toFixed(2)} — good. Maintain or slightly increase`; }
      else if (cpa > 0 && cpa < 15)    { verdict = 'OPTIMISE'; action = `CPA £${cpa.toFixed(2)} — acceptable but room to improve. Tighten keywords`; }
      else if (cpa >= 15)              { verdict = 'REDUCE';   action = `CPA £${cpa.toFixed(2)} — too high. Reduce budget or restructure`; }
      else                             { verdict = 'MONITOR';  action = 'Collecting data'; }

      return {
        id: ag.id, name: ag.name, status: ag.status,
        campaignName: c.name, campaignId: c.id,
        cost, conv,
        clicks: parseInt(m.clicks || 0),
        impressions: parseInt(m.impressions || 0),
        convValue: parseFloat(m.conversionsValue || 0),
        ctr: parseFloat(m.ctr || 0) * 100,
        avgCpc: (m.averageCpc || 0) / 1e6,
        cpa, verdict, action,
        impressionShare: parseFloat(m.searchImpressionShare || 0) * 100,
      };
    });

    // ── 3. KEYWORDS ──────────────────────────────────────────────
    const kwData = await gaql(`
      SELECT ad_group_criterion.keyword.text,
        ad_group_criterion.keyword.match_type,
        ad_group_criterion.status,
        ad_group_criterion.quality_info.quality_score,
        ad_group.name, campaign.name,
        metrics.cost_micros, metrics.clicks, metrics.impressions,
        metrics.conversions, metrics.ctr, metrics.average_cpc
      FROM keyword_view
      WHERE segments.date DURING LAST_30_DAYS
        AND ad_group_criterion.status = 'ENABLED'
        AND campaign.status = 'ENABLED'
      ORDER BY metrics.cost_micros DESC
      LIMIT 200
    `);

    const keywords = (kwData.results || []).map(row => {
      const kw = row.adGroupCriterion, m = row.metrics;
      const cost = (m.costMicros || 0) / 1e6;
      const conv = parseFloat(m.conversions || 0);
      const qs   = kw.qualityInfo?.qualityScore || 0;

      let kwVerdict;
      if (conv === 0 && cost > 5)  kwVerdict = 'PAUSE';
      else if (conv === 0 && cost > 1) kwVerdict = 'REVIEW';
      else if (qs > 0 && qs < 5)   kwVerdict = 'LOW QS — improve';
      else if (conv > 0 && (cost/conv) < 3) kwVerdict = 'SCALE UP';
      else if (conv > 0)            kwVerdict = 'KEEP';
      else                          kwVerdict = 'MONITOR';

      return {
        text: kw.keyword?.text || '',
        matchType: kw.keyword?.matchType || '',
        adGroup: row.adGroup?.name || '',
        campaign: row.campaign?.name || '',
        cost, conv,
        clicks: parseInt(m.clicks || 0),
        impressions: parseInt(m.impressions || 0),
        ctr: parseFloat(m.ctr || 0) * 100,
        avgCpc: (m.averageCpc || 0) / 1e6,
        cpa: conv > 0 ? cost / conv : 0,
        qualityScore: qs,
        verdict: kwVerdict,
      };
    });

    // ── 4. SEARCH TERMS (top wasted + top converting) ────────────
    const stData = await gaql(`
      SELECT search_term_view.search_term,
        search_term_view.status,
        ad_group.name, campaign.name,
        metrics.cost_micros, metrics.clicks, metrics.impressions,
        metrics.conversions, metrics.ctr
      FROM search_term_view
      WHERE segments.date DURING LAST_30_DAYS
        AND metrics.impressions > 10
      ORDER BY metrics.cost_micros DESC
      LIMIT 500
    `);

    const searchTerms = (stData.results || []).map(row => {
      const m = row.metrics;
      const cost = (m.costMicros || 0) / 1e6;
      const conv = parseFloat(m.conversions || 0);
      return {
        term: row.searchTermView?.searchTerm || '',
        status: row.searchTermView?.status || '',
        adGroup: row.adGroup?.name || '',
        campaign: row.campaign?.name || '',
        cost, conv,
        clicks: parseInt(m.clicks || 0),
        impressions: parseInt(m.impressions || 0),
        ctr: parseFloat(m.ctr || 0) * 100,
        cpa: conv > 0 ? cost / conv : 0,
        wasted: conv === 0 && cost > 0.50,
      };
    });

    // ── 5. DEVICE BREAKDOWN ──────────────────────────────────────
    const devData = await gaql(`
      SELECT campaign.name, segments.device,
        metrics.cost_micros, metrics.clicks,
        metrics.conversions, metrics.conversions_value
      FROM campaign
      WHERE segments.date DURING LAST_30_DAYS
        AND campaign.status = 'ENABLED'
      ORDER BY campaign.name, segments.device
      LIMIT 100
    `);

    const devices = (devData.results || []).map(row => {
      const m = row.metrics;
      const cost = (m.costMicros || 0) / 1e6;
      const conv = parseFloat(m.conversions || 0);
      return {
        campaign: row.campaign?.name || '',
        device: row.segments?.device || '',
        cost, conv,
        clicks: parseInt(m.clicks || 0),
        cpa: conv > 0 ? cost / conv : 0,
        convRate: parseInt(m.clicks||0) > 0 ? (conv / parseInt(m.clicks||0) * 100) : 0,
      };
    });

    // ── 6. LANDING PAGES ────────────────────────────────────────
    const lpData = await gaql(`
      SELECT landing_page_view.unexpanded_final_url,
        campaign.name, ad_group.name,
        metrics.clicks, metrics.impressions,
        metrics.conversions, metrics.cost_micros,
        metrics.average_cpc
      FROM landing_page_view
      WHERE segments.date DURING LAST_30_DAYS
        AND metrics.clicks > 5
      ORDER BY metrics.cost_micros DESC
      LIMIT 100
    `);

    const landingPages = (lpData.results || []).map(row => {
      const m = row.metrics;
      const cost = (m.costMicros || 0) / 1e6;
      const conv = parseFloat(m.conversions || 0);
      const clicks = parseInt(m.clicks || 0);
      return {
        url: row.landingPageView?.unexpandedFinalUrl || '',
        campaign: row.campaign?.name || '',
        adGroup: row.adGroup?.name || '',
        cost, conv, clicks,
        impressions: parseInt(m.impressions || 0),
        convRate: clicks > 0 ? (conv / clicks * 100) : 0,
        avgCpc: (m.averageCpc || 0) / 1e6,
        needsFix: clicks > 20 && conv === 0,
      };
    });

    // ── TOTALS ───────────────────────────────────────────────────
    const totalSpend = campaigns.reduce((s,c)=>s+c.cost, 0);
    const totalClicks = campaigns.reduce((s,c)=>s+c.clicks, 0);
    const totalConv  = campaigns.reduce((s,c)=>s+c.conversions, 0);
    const totalConvValue = campaigns.reduce((s,c)=>s+c.convValue, 0);
    const wastedSpend = searchTerms.filter(t=>t.wasted).reduce((s,t)=>s+t.cost, 0);

    // ── SMART INSIGHTS ──────────────────────────────────────────
    const insights = [];

    // Best ad group
    const bestAG = adGroups.filter(ag=>ag.conv>0).sort((a,b)=>a.cpa-b.cpa)[0];
    if(bestAG) insights.push({ type:'win', msg:`Best ad group: "${bestAG.name}" at £${bestAG.cpa.toFixed(2)} CPA — scale this up` });

    // Worst ad group
    const worstAG = adGroups.filter(ag=>ag.cost>5&&ag.conv===0).sort((a,b)=>b.cost-a.cost)[0];
    if(worstAG) insights.push({ type:'alert', msg:`Worst ad group: "${worstAG.name}" — £${worstAG.cost.toFixed(2)} spent, zero conversions — pause immediately` });

    // Desktop opportunity
    const desktopAll = devices.filter(d=>d.device==='DESKTOP');
    const mobileAll  = devices.filter(d=>d.device==='MOBILE');
    const desktopCR = desktopAll.reduce((s,d)=>s+d.conv,0) / Math.max(desktopAll.reduce((s,d)=>s+d.clicks,0),1) * 100;
    const mobileCR  = mobileAll.reduce((s,d)=>s+d.conv,0)  / Math.max(mobileAll.reduce((s,d)=>s+d.clicks,0),1)  * 100;
    if(desktopCR > mobileCR * 1.1)
      insights.push({ type:'tip', msg:`Desktop converts at ${desktopCR.toFixed(1)}% vs mobile ${mobileCR.toFixed(1)}% — increase desktop bid +${Math.round((desktopCR/mobileCR-1)*100)}%` });

    // Wasted spend
    if(wastedSpend > 10)
      insights.push({ type:'alert', msg:`£${wastedSpend.toFixed(2)} wasted on ${searchTerms.filter(t=>t.wasted).length} zero-conversion search terms — add as negatives` });

    // Low quality scores
    const lowQS = keywords.filter(kw=>kw.qualityScore>0&&kw.qualityScore<5);
    if(lowQS.length)
      insights.push({ type:'tip', msg:`${lowQS.length} keywords with quality score under 5 — rewrite ad copy for these to reduce CPC` });

    // Landing pages needing fixes
    const brokenLPs = landingPages.filter(lp=>lp.needsFix);
    if(brokenLPs.length)
      insights.push({ type:'alert', msg:`${brokenLPs.length} landing pages with 20+ clicks but zero conversions — fix these pages` });

    res.json({
      campaigns, adGroups, keywords, searchTerms, devices, landingPages,
      totalSpend, totalClicks, totalConv, totalConvValue, wastedSpend,
      insights,
      fetchedAt: new Date().toISOString(),
      live: true,
    });

  } catch (err) {
    console.error('Google Ads error:', err.message);
    res.status(500).json({ error: err.message });
  }
}
