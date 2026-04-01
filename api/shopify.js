export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  const { domain, token, endpoint, limit = 50, handle, fields, status, order, page_info } = req.query;

  if (!domain || !token) {
    return res.status(400).json({ error: 'Missing domain or token' });
  }

  const base = `https://${domain}/admin/api/2024-01`;
  const headers = {
    'X-Shopify-Access-Token': token,
    'Content-Type': 'application/json',
  };

  try {
    let url, data;

    if (endpoint === 'products') {
      const params = new URLSearchParams({ limit: limit || 50 });
      if (status) params.set('status', status);
      if (order) params.set('order', order);
      if (fields) params.set('fields', fields);
      if (page_info) params.set('page_info', page_info);
      url = `${base}/products.json?${params}`;
      const r = await fetch(url, { headers });
      if (!r.ok) throw new Error(`Shopify ${r.status}: ${await r.text()}`);
      data = await r.json();
      // Pass pagination link header through
      const linkHeader = r.headers.get('link');
      if (linkHeader) {
        const nextMatch = linkHeader.match(/<[^>]+page_info=([^&>]+)[^>]*>;\s*rel="next"/);
        if (nextMatch) data._link = nextMatch[1];
      }
      return res.json(data);
    }

    if (endpoint === 'product_by_handle') {
      url = `${base}/products.json?handle=${handle}&limit=1`;
      const r = await fetch(url, { headers });
      if (!r.ok) throw new Error(`Shopify ${r.status}`);
      const d = await r.json();
      return res.json({ product: d.products?.[0] || null });
    }

    if (endpoint === 'collections') {
      // Fetch both custom and smart collections
      const [customR, smartR] = await Promise.all([
        fetch(`${base}/custom_collections.json?limit=250`, { headers }),
        fetch(`${base}/smart_collections.json?limit=250`, { headers }),
      ]);
      const customData = customR.ok ? await customR.json() : { custom_collections: [] };
      const smartData = smartR.ok ? await smartR.json() : { smart_collections: [] };

      // Get product counts for each collection
      const allColls = [
        ...(customData.custom_collections || []),
        ...(smartData.smart_collections || []),
      ];

      // Fetch counts in parallel (batch of 10)
      const withCounts = await Promise.all(
        allColls.map(async c => {
          try {
            const cr = await fetch(`${base}/collections/${c.id}/products/count.json`, { headers });
            const cd = cr.ok ? await cr.json() : { count: 0 };
            return { ...c, products_count: cd.count };
          } catch {
            return { ...c, products_count: 0 };
          }
        })
      );

      return res.json({
        custom_collections: withCounts.filter(c => customData.custom_collections?.find(x => x.id === c.id)),
        smart_collections: withCounts.filter(c => smartData.smart_collections?.find(x => x.id === c.id)),
      });
    }

    if (endpoint === 'image_proxy') {
      const { url: imgUrl } = req.query;
      if (!imgUrl) return res.status(400).json({ error: 'No URL' });
      const r = await fetch(imgUrl);
      if (!r.ok) throw new Error(`Image fetch failed: ${r.status}`);
      const buf = await r.arrayBuffer();
      const ct = r.headers.get('content-type') || 'image/jpeg';
      res.setHeader('Content-Type', ct);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.send(Buffer.from(buf));
    }

    return res.status(400).json({ error: `Unknown endpoint: ${endpoint}` });

  } catch (err) {
    console.error('Shopify API error:', err.message);
    res.status(500).json({ error: err.message });
  }
}
