export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  const { apiKey, scData, shopifyData, adsData } = req.method === 'POST'
    ? await req.json ? req.json() : new Promise(resolve => {
        let body = '';
        req.on('data', c => body += c);
        req.on('end', () => resolve(JSON.parse(body)));
      })
    : {};

  if (!apiKey) return res.status(400).json({ error: 'No API key' });

  const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  const prompt = `You are a content strategist for CC Hair & Beauty (cchairandbeauty.com), a Leeds UK Afro-Caribbean hair and beauty retailer established 1979. 3 branches: Chapeltown LS7, Roundhay LS8, City Centre.

Today: ${today}

LIVE DATA:
${scData ? `Search Console top opportunities: ${JSON.stringify(scData.lowCTR?.slice(0,8))}
Near page 1: ${JSON.stringify(scData.nearPage1?.slice(0,6))}` : ''}
${shopifyData ? `Top sellers this week: ${JSON.stringify(shopifyData.topProducts?.slice(0,5))}` : ''}
${adsData ? `Ad campaigns: ${JSON.stringify(adsData.campaigns?.slice(0,5))}` : ''}

COMPETITORS:
- Pak's Cosmetics: London-based, Europe's largest, 1,708 Trustpilot reviews, posts daily on Instagram, competes on price and delivery
- Shaba Cosmetics: London-based, 45,000 products, website currently down for maintenance (OPPORTUNITY)
- Both are NOT Leeds-based — this is CC Hair's biggest advantage

Generate a 4-WEEK content calendar. For each week provide EXACTLY this JSON structure:
{
  "weeks": [
    {
      "week": 1,
      "theme": "short theme title",
      "blog": {
        "title": "exact blog title",
        "keyword": "target keyword",
        "why": "why this will rank",
        "outline": ["intro point", "section 1", "section 2", "section 3", "conclusion"]
      },
      "social": [
        {"day": "Monday", "platform": "Facebook", "caption": "full ready-to-post caption", "hashtags": "#tag1 #tag2 #tag3"},
        {"day": "Wednesday", "platform": "Instagram", "caption": "full ready-to-post caption", "hashtags": "#tag1 #tag2"},
        {"day": "Friday", "platform": "Facebook+Instagram", "caption": "full ready-to-post caption", "hashtags": "#tag1 #tag2 #tag3"}
      ],
      "gbp": "exact Google Business Profile post text (max 1500 chars)",
      "review_ask": "exact WhatsApp message to send to customers asking for a review",
      "ads_focus": "which campaign to increase budget on this week and why"
    }
  ]
}

Make captions specific to Leeds, mention local community, reference CC Hair's 45+ years. Make them ready to copy and paste with zero editing needed. Return ONLY the JSON, no other text.`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const d = await r.json();
    if (d.error) throw new Error(d.error.message);
    const text = d.content?.[0]?.text || '';
    const clean = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    res.json(parsed);
  } catch (err) {
    console.error('Content calendar error:', err.message);
    res.status(500).json({ error: err.message });
  }
}
