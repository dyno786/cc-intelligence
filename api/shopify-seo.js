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

  async function sf(url, options = {}) {
    return fetch(url, { ...options, headers });
  }

  // ── GET — read current SEO ──────────────────────────────────────────────────
  if (req.method === 'GET') {
    const { type, id } = req.query;
    if (!id || !type) return res.status(400).json({ error: 'Missing id or type' });

    try {
      let item, collType = null;

      if (type === 'collection') {
        let r = await sf(`${base}/custom_collections/${id}.json`);
        if (r.ok) { const d = await r.json(); item = d.custom_collection; collType = 'custom'; }
        else {
          r = await sf(`${base}/smart_collections/${id}.json`);
          if (r.ok) { const d = await r.json(); item = d.smart_collection; collType = 'smart'; }
        }
        if (!item) throw new Error('Collection not found');
      } else {
        const r = await sf(`${base}/products/${id}.json?fields=id,title,handle,body_html`);
        if (!r.ok) throw new Error(`Product not found (${r.status})`);
        const d = await r.json(); item = d.product;
      }

      // Fetch metafields
      const mfUrl = type === 'collection'
        ? `${base}/metafields.json?metafield[owner_resource]=collection&metafield[owner_id]=${id}`
        : `${base}/products/${id}/metafields.json`;
      const mfR = await sf(mfUrl);
      const mfs = mfR.ok ? (await mfR.json()).metafields || [] : [];

      return res.json({
        id: item.id, title: item.title, handle: item.handle,
        seoTitle: mfs.find(m => m.namespace==='global' && m.key==='title_tag')?.value || '',
        seoDescription: mfs.find(m => m.namespace==='global' && m.key==='description_tag')?.value || '',
        bodyHtml: item.body_html || '',
        collType,
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── POST — write SEO ────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    const { type, id, seoTitle, seoDescription, bodyHtml, collType } = req.body;
    if (!id || !type) return res.status(400).json({ error: 'Missing id or type' });

    const results = [], errors = [];

    // 1. Update SEO metafields (title_tag + description_tag)
    for (const [key, value, mfType] of [
      ['title_tag', seoTitle, 'single_line_text_field'],
      ['description_tag', seoDescription, 'multi_line_text_field'],
    ]) {
      if (!value) continue;
      try {
        const ownerResource = type === 'collection' ? 'collection' : 'product';
        // Search for existing
        const searchUrl = type === 'collection'
          ? `${base}/metafields.json?metafield[owner_resource]=collection&metafield[owner_id]=${id}&metafield[namespace]=global&metafield[key]=${key}`
          : `${base}/products/${id}/metafields.json?namespace=global&key=${key}`;
        const sr = await sf(searchUrl);
        const existing = sr.ok ? (await sr.json()).metafields?.[0] : null;

        let r;
        if (existing) {
          r = await sf(`${base}/metafields/${existing.id}.json`, {
            method: 'PUT',
            body: JSON.stringify({ metafield: { id: existing.id, value, type: mfType } }),
          });
        } else {
          r = await sf(`${base}/metafields.json`, {
            method: 'POST',
            body: JSON.stringify({ metafield: { namespace:'global', key, value, type: mfType, owner_id: Number(id), owner_resource: ownerResource } }),
          });
        }

        if (r.ok) {
          results.push({ field: key, status: 'updated' });
        } else {
          const err = await r.text();
          if (err.includes('write_products') || err.includes('merchant approval') || err.includes('write_content')) {
            errors.push(`SCOPE_ERROR: Your Shopify token needs write_products (products) or write_content (collections) scope. Go to Shopify Admin → Settings → Apps → Develop apps → your app → Configuration → add the scope → Save → rotate token → update in ⚙ Settings.`);
            break; // No point trying more if scope is wrong
          }
          errors.push(`${key}: ${err.substring(0, 200)}`);
        }
      } catch (e) { errors.push(`${key}: ${e.message}`); }
    }

    // 2. Update body_html description
    if (bodyHtml && !errors.some(e => e.startsWith('SCOPE_ERROR'))) {
      try {
        let r;
        if (type === 'collection') {
          // Smart collections don't support body_html
          const isCustom = collType === 'custom' || (!collType && (await sf(`${base}/custom_collections/${id}.json`)).ok);
          if (!isCustom) {
            results.push({ field: 'body_html', status: 'skipped', reason: 'Smart collections cannot have descriptions updated via API' });
          } else {
            r = await sf(`${base}/custom_collections/${id}.json`, {
              method: 'PUT',
              body: JSON.stringify({ custom_collection: { id: Number(id), body_html: bodyHtml } }),
            });
            if (r.ok) results.push({ field: 'body_html', status: 'updated' });
            else errors.push(`description: ${(await r.text()).substring(0, 200)}`);
          }
        } else {
          r = await sf(`${base}/products/${id}.json`, {
            method: 'PUT',
            body: JSON.stringify({ product: { id: Number(id), body_html: bodyHtml } }),
          });
          if (r.ok) results.push({ field: 'body_html', status: 'updated' });
          else errors.push(`description: ${(await r.text()).substring(0, 200)}`);
        }
      } catch (e) { errors.push(`description: ${e.message}`); }
    }

    if (results.length === 0 && errors.length > 0) {
      // Clean up scope error message for the UI
      const scopeErr = errors.find(e => e.startsWith('SCOPE_ERROR:'));
      return res.status(403).json({ error: scopeErr || errors[0], errors, scopeError: !!scopeErr });
    }

    return res.json({ success: true, updated: results, errors: errors.length ? errors : undefined });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
