export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { domain, token } = req.query;
  if (!domain || !token) return res.status(400).json({ error: 'domain and token required' });

  const base = `https://${domain}/admin/api/2024-01`;
  const headers = { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' };

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  weekAgo.setHours(0, 0, 0, 0);

  try {
    // Fetch orders from last 7 days + today
    const [weekRes, recentRes] = await Promise.all([
      fetch(`${base}/orders.json?status=any&created_at_min=${weekAgo.toISOString()}&limit=250&fields=id,order_number,created_at,total_price,financial_status,line_items,customer`, { headers }),
      fetch(`${base}/orders.json?status=any&created_at_min=${today.toISOString()}&limit=50&fields=id,order_number,created_at,total_price,financial_status,line_items,customer`, { headers }),
    ]);

    const weekData = await weekRes.json();
    const recentData = await recentRes.json();

    if (weekData.errors) throw new Error(JSON.stringify(weekData.errors));

    const weekOrders = weekData.orders || [];
    const todayOrders = recentData.orders || [];

    // Calculate revenue
    const weekRevenue = weekOrders.reduce((s, o) => s + parseFloat(o.total_price || 0), 0);
    const todayRevenue = todayOrders.reduce((s, o) => s + parseFloat(o.total_price || 0), 0);
    const avgOrderValue = weekOrders.length > 0 ? weekRevenue / weekOrders.length : 0;

    // Top products by quantity this week
    const productMap = {};
    weekOrders.forEach(order => {
      (order.line_items || []).forEach(item => {
        const key = String(item.product_id);
        if (!productMap[key]) {
          productMap[key] = { title: item.title, quantity: 0, revenue: 0, image: null };
        }
        productMap[key].quantity += item.quantity;
        productMap[key].revenue += parseFloat(item.price || 0) * item.quantity;
      });
    });

    const topProducts = Object.values(productMap)
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 10);

    // Fetch images for top 5 products
    const topIds = Object.entries(productMap)
      .sort((a, b) => b[1].quantity - a[1].quantity)
      .slice(0, 5)
      .map(([id]) => id);

    if (topIds.length > 0) {
      const imgRes = await fetch(`${base}/products.json?ids=${topIds.join(',')}&fields=id,title,images`, { headers });
      const imgData = await imgRes.json();
      (imgData.products || []).forEach(p => {
        const key = String(p.id);
        if (productMap[key]) productMap[key].image = p.images?.[0]?.src || null;
      });
    }

    // Recent orders for display
    const recentOrders = weekOrders.slice(0, 20).map(o => ({
      number: o.order_number,
      date: o.created_at,
      total: parseFloat(o.total_price || 0),
      status: o.financial_status,
      customer: o.customer ? `${o.customer.first_name || ''} ${o.customer.last_name || ''}`.trim() : 'Guest',
      items: (o.line_items || []).map(i => i.title).join(', ').substring(0, 60),
    }));

    res.json({
      weekRevenue: parseFloat(weekRevenue.toFixed(2)),
      todayRevenue: parseFloat(todayRevenue.toFixed(2)),
      weekOrders: weekOrders.length,
      todayOrders: todayOrders.length,
      avgOrderValue: parseFloat(avgOrderValue.toFixed(2)),
      topProducts: topProducts.map(p => ({ ...p, revenue: parseFloat(p.revenue.toFixed(2)) })),
      recentOrders,
    });

  } catch (err) {
    console.error('Shopify error:', err.message);
    res.status(500).json({ error: err.message });
  }
}
