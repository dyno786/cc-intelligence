export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  const { domain, token } = req.method === 'GET' ? req.query : req.body;

  if (!domain || !token) {
    return res.status(400).json({ error: 'Missing domain or token' });
  }

  const base = `https://${domain}/admin/api/2024-01`;
  const headers = {
    'X-Shopify-Access-Token': token,
    'Content-Type': 'application/json',
  };

  // GET — read SEO fields for a product or collection
  if (req.method === 'GET') {
    const { type, id } = req.query; // type = 'product' | 'collection'
    try {
      const endpoint = type === 'collection'
        ? `${base}/collections/${id}.json`
        : `${base}/products/${id}.json?fields=id,title,handle,metafields,body_html,images,product_type,vendor`;
      const r = await fetch(endpoint, { headers });
      if (!r.ok) throw new Error(`Shopify ${r.status}`);
      const d = await r.json();
      const item = d.product || d.collection;

      // Also fetch metafields for SEO title/desc
      const mfR = await fetch(`${base}/${type === 'collection' ? 'collections' : 'products'}/${id}/metafields.json`, { headers });
      const mfData = mfR.ok ? await mfR.json() : { metafields: [] };
      const mfs = mfData.metafields || [];

      const seoTitle = mfs.find(m => m.namespace === 'global' && m.key === 'title_tag')?.value || item.title || '';
      const seoDesc = mfs.find(m => m.namespace === 'global' && m.key === 'description_tag')?.value || '';

      return res.json({
        id: item.id,
        title: item.title,
        handle: item.handle,
        seoTitle,
        seoDescription: seoDesc,
        bodyHtml: item.body_html || '',
        metafields: mfs,
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // POST — write SEO fields back to Shopify
  if (req.method === 'POST') {
    const { type, id, seoTitle, seoDescription, bodyHtml } = req.body;
    if (!id || !type) return res.status(400).json({ error: 'Missing id or type' });

    const results = [];

    try {
      // Update metafields for SEO title and description
      if (seoTitle !== undefined || seoDescription !== undefined) {
        const metafieldsToUpdate = [];

        if (seoTitle !== undefined) {
          metafieldsToUpdate.push({
            namespace: 'global',
            key: 'title_tag',
            value: seoTitle,
            type: 'single_line_text_field',
          });
        }
        if (seoDescription !== undefined) {
          metafieldsToUpdate.push({
            namespace: 'global',
            key: 'description_tag',
            value: seoDescription,
            type: 'multi_line_text_field',
          });
        }

        for (const mf of metafieldsToUpdate) {
          // Check if metafield already exists
          const existingR = await fetch(
            `${base}/${type === 'collection' ? 'collections' : 'products'}/${id}/metafields.json?namespace=global&key=${mf.key}`,
            { headers }
          );
          const existingData = existingR.ok ? await existingR.json() : { metafields: [] };
          const existing = existingData.metafields?.[0];

          let mfR;
          if (existing) {
            // Update existing metafield
            mfR = await fetch(`${base}/metafields/${existing.id}.json`, {
              method: 'PUT',
              headers,
              body: JSON.stringify({ metafield: { id: existing.id, value: mf.value, type: mf.type } }),
            });
          } else {
            // Create new metafield
            const ownerResource = type === 'collection' ? 'collection' : 'product';
            mfR = await fetch(`${base}/metafields.json`, {
              method: 'POST',
              headers,
              body: JSON.stringify({
                metafield: {
                  ...mf,
                  owner_id: id,
                  owner_resource: ownerResource,
                },
              }),
            });
          }
          if (!mfR.ok) {
            const errText = await mfR.text();
            throw new Error(`Metafield update failed: ${errText}`);
          }
          results.push({ field: mf.key, status: 'updated' });
        }
      }

      // Update body HTML (description) if provided
      if (bodyHtml !== undefined) {
        const endpoint = type === 'collection'
          ? `${base}/collections/${id}.json`
          : `${base}/products/${id}.json`;
        const payload = type === 'collection'
          ? { collection: { id, body_html: bodyHtml } }
          : { product: { id, body_html: bodyHtml } };
        const r = await fetch(endpoint, {
          method: 'PUT',
          headers,
          body: JSON.stringify(payload),
        });
        if (!r.ok) throw new Error(`Body update failed: ${await r.text()}`);
        results.push({ field: 'body_html', status: 'updated' });
      }

      return res.json({ success: true, updated: results });
    } catch (err) {
      console.error('SEO update error:', err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
