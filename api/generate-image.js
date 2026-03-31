export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { productImageUrl, productName, productType, setting, width, height, apiKey } = req.body;

  const openaiKey = apiKey || process.env.OPENAI_API_KEY;
  if (!openaiKey) return res.status(400).json({ error: 'No OpenAI API key' });
  if (!productImageUrl) return res.status(400).json({ error: 'No product image URL' });

  const SETTING_PROMPTS = {
    studio:   'Clean white studio surface, soft grey gradient background, professional product photography lighting from above, natural shadow underneath.',
    salon:    'Professional beauty salon counter, clean aesthetic, styling tools softly visible in background, warm studio lighting.',
    bathroom: 'Clean marble bathroom shelf, soft warm lighting, white towels slightly out of focus in background.',
    barber:   'Barbershop counter, dark wood surface, chrome accents, mirror reflection softly visible in background.',
    bedroom:  'Bedroom vanity dressing table, warm soft lighting, round mirror partially visible in background.',
    natural:  'Wooden surface surrounded by natural botanicals — eucalyptus leaves, dried flowers, soft natural window light.',
  };

  const settingDesc = SETTING_PROMPTS[setting] || SETTING_PROMPTS.studio;
  const w = width || 1080;
  const h = height || 1080;

  // Determine DALL-E size — must be one of the supported sizes
  // We generate at 1024x1024 then specify the intended dimensions in the prompt
  const dalleSize = w === h ? '1024x1024' : (w > h ? '1792x1024' : '1024x1792');

  const prompt = [
    `Professional product photography for social media marketing of a hair and beauty product.`,
    `Product: ${productName}. Type: ${productType || 'hair product'}.`,
    settingDesc,
    `The product is the clear focal point, label fully visible and readable.`,
    `Keep original product packaging exactly as-is — only change the background and setting.`,
    `No people, no faces, no hands. Photorealistic. High detail. Clean, professional aesthetic.`,
    `Output dimensions: ${w}x${h}px.`,
    `Small semi-transparent watermark text 'cchairandbeauty.com' at very bottom edge.`,
  ].join(' ');

  try {
    // Step 1: fetch the product image and convert to base64
    const imgResponse = await fetch(productImageUrl);
    if (!imgResponse.ok) throw new Error(`Could not fetch product image: ${imgResponse.status}`);
    const imgBuffer = await imgResponse.arrayBuffer();
    const imgBase64 = Buffer.from(imgBuffer).toString('base64');
    const imgMime = imgResponse.headers.get('content-type') || 'image/jpeg';

    // Step 2: Use GPT-4o image input to describe the product, then generate with DALL-E
    // First get a detailed description of the product from vision
    const visionRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openaiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o',
        max_tokens: 200,
        messages: [{
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:${imgMime};base64,${imgBase64}`, detail: 'low' } },
            { type: 'text', text: 'Describe this product\'s packaging in detail: shape, size, colours, label text, bottle/container type. Be specific and concise. Max 100 words.' }
          ]
        }]
      })
    });
    const visionData = await visionRes.json();
    const productDesc = visionData.choices?.[0]?.message?.content || `${productName} product`;

    // Step 3: Generate the image with DALL-E 3
    const genRes = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openaiKey}` },
      body: JSON.stringify({
        model: 'dall-e-3',
        prompt: `${prompt} Exact product description: ${productDesc}`,
        n: 1,
        size: dalleSize,
        quality: 'standard',
        response_format: 'b64_json',
      })
    });

    const genData = await genRes.json();
    if (genData.error) throw new Error(genData.error.message || JSON.stringify(genData.error));

    const b64 = genData.data?.[0]?.b64_json;
    if (!b64) throw new Error('No image data returned from DALL-E');

    res.json({
      image_b64: b64,
      width: w,
      height: h,
      setting,
      estimated_cost: '~4p',
    });

  } catch (err) {
    console.error('generate-image error:', err.message);
    res.status(500).json({ error: err.message });
  }
}
