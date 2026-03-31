export const config = { maxDuration: 60 };

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try { resolve(JSON.parse(body)); }
      catch(e) { resolve({}); }
    });
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { apiKey, scData, shopifyData, adsData } = await parseBody(req);

  if (!apiKey) return res.status(400).json({ error: 'No API key provided' });

  const today = new Date().toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });

  const prompt = `You are a content strategist for CC Hair & Beauty (cchairandbeauty.com), a Leeds UK Afro-Caribbean hair and beauty retailer established 1979. 3 branches: Chapeltown LS7, Roundhay LS8, City Centre.

Today: ${today}

LIVE DATA:
${scData ? `Search Console top opportunities: ${JSON.stringify((scData.lowCTR||[]).slice(0,8))}
Near page 1: ${JSON.stringify((scData.nearPage1||[]).slice(0,6))}` : 'No Search Console data'}
${shopifyData ? `Top sellers this week: ${JSON.stringify((shopifyData.topProducts||[]).slice(0,5))}` : 'No Shopify data'}
${adsData ? `Ad campaigns: ${JSON.stringify((adsData.campaigns||[]).slice(0,5))}` : 'No Ads data'}

COMPETITORS:
- Pak Cosmetics: London-based, Europe largest, 1708 Trustpilot reviews, posts daily on Instagram, competes on price and delivery
- Shaba Cosmetics: London-based, 45000 products, website currently down for maintenance (OPPORTUNITY NOW)
- Both are NOT Leeds-based. CC Hair advantage: local community, same-day collection, established 1979

Generate a 4-WEEK content calendar. Return ONLY valid JSON, no markdown, no backticks, no preamble:
{"weeks":[{"week":1,"theme":"short theme","blog":{"title":"exact blog title","keyword":"target keyword","why":"why this ranks","outline":["point1","point2","point3","point4"]},"social":[{"day":"Monday","platform":"Facebook","caption":"full ready-to-post caption Leeds specific","hashtags":"#tag1 #tag2 #tag3"},{"day":"Wednesday","platform":"Instagram","caption":"full caption","hashtags":"#tag1 #tag2"},{"day":"Friday","platform":"Facebook and Instagram","caption":"full caption","hashtags":"#tag1 #tag2 #tag3"}],"gbp":"Google Business Profile post text under 1500 chars","review_ask":"WhatsApp message to send customers asking for Google review","ads_focus":"which campaign to increase this week and why"}]}

Make all captions Leeds-specific, mention local community, reference CC Hair 45 years. Ready to copy paste with zero editing. Return ONLY the JSON.`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4000,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const d = await r.json();
    if (d.error) throw new Error(d.error.message || JSON.stringify(d.error));

    const text = d.content?.[0]?.text || '';
    const clean = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    res.json(parsed);

  } catch (err) {
    console.error('Content calendar error:', err.message);
    res.status(500).json({ error: err.message });
  }
}
