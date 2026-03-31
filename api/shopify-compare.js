export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  const { domain, token } = req.query;
  if (!token || !domain) return res.status(400).json({ error: 'Missing domain or token' });

  const base = `https://${domain}/admin/api/2024-01`;
  const headers = { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' };

  try {
    const now = new Date();
    
    // This week: Mon to now
    const thisMonday = new Date(now);
    thisMonday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    thisMonday.setHours(0, 0, 0, 0);

    // Last week: Mon to Sun
    const lastMonday = new Date(thisMonday);
    lastMonday.setDate(thisMonday.getDate() - 7);
    const lastSunday = new Date(thisMonday);
    lastSunday.setMilliseconds(-1);

    const [thisWeekR, lastWeekR] = await Promise.all([
      fetch(`${base}/orders.json?status=any&created_at_min=${thisMonday.toISOString()}&limit=250`, { headers }),
      fetch(`${base}/orders.json?status=any&created_at_min=${lastMonday.toISOString()}&created_at_max=${lastSunday.toISOString()}&limit=250`, { headers }),
    ]);

    const [thisWeekData, lastWeekData] = await Promise.all([thisWeekR.json(), lastWeekR.json()]);

    function aggregateProducts(orders) {
      const map = {};
      for (const order of (orders.orders || [])) {
        if (order.financial_status === 'voided') continue;
        for (const item of (order.line_items || [])) {
          const id = item.product_id;
          if (!map[id]) map[id] = { id, title: item.title, quantity: 0, revenue: 0, image: null };
          map[id].quantity += item.quantity;
          map[id].revenue += parseFloat(item.price) * item.quantity;
        }
      }
      return Object.values(map).sort((a, b) => b.quantity - a.quantity).slice(0, 10);
    }

    const thisWeekProducts = aggregateProducts(thisWeekData);
    const lastWeekProducts = aggregateProducts(lastWeekData);

    // Build comparison
    const lastWeekMap = {};
    lastWeekProducts.forEach(p => { lastWeekMap[p.id] = p; });

    const comparison = thisWeekProducts.map(p => {
      const last = lastWeekMap[p.id];
      const lastQty = last ? last.quantity : 0;
      const diff = p.quantity - lastQty;
      const trend = diff > 0 ? 'up' : diff < 0 ? 'down' : lastQty === 0 ? 'new' : 'same';
      return { ...p, lastQty, diff, trend };
    });

    // Revenue comparison
    const thisRevenue = (thisWeekData.orders || []).reduce((s, o) => s + parseFloat(o.total_price || 0), 0);
    const lastRevenue = (lastWeekData.orders || []).reduce((s, o) => s + parseFloat(o.total_price || 0), 0);
    const thisOrders = (thisWeekData.orders || []).length;
    const lastOrders = (lastWeekData.orders || []).length;

    res.json({
      thisWeek: { revenue: thisRevenue, orders: thisOrders, products: thisWeekProducts },
      lastWeek: { revenue: lastRevenue, orders: lastOrders, products: lastWeekProducts },
      comparison,
      revenueDiff: thisRevenue - lastRevenue,
      revenueChange: lastRevenue > 0 ? ((thisRevenue - lastRevenue) / lastRevenue * 100) : 0,
    });

  } catch (err) {
    console.error('Shopify compare error:', err.message);
    res.status(500).json({ error: err.message });
  }
}
