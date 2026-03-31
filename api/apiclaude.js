export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { apiKey, model, max_tokens, messages, system } = req.body;
    if (!apiKey || !apiKey.startsWith('sk-')) {
      return res.status(401).json({ error: { message: 'Add your Anthropic API key in Settings.' } });
    }
    const body = { model: model || 'claude-sonnet-4-20250514', max_tokens: max_tokens || 3000, messages };
    if (system) body.system = system;
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    return res.status(r.status).json(data);
  } catch (err) {
    return res.status(500).json({ error: { message: err.message } });
  }
}
