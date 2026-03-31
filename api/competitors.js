export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  const placesKey = process.env.GOOGLE_PLACES_API_KEY || '';

  if (!placesKey) {
    return res.json({ error: 'GOOGLE_PLACES_API_KEY not set', competitors: [], mapPack: [] });
  }

  // Cache: only fetch once per day (stored in response headers concept)
  const queries = [
    { term: 'hair shop Leeds', monthly: 1200 },
    { term: 'afro hair products Leeds', monthly: 480 },
    { term: 'hair relaxer Leeds', monthly: 210 },
    { term: 'hair extensions Leeds', monthly: 890 },
    { term: 'black hair shop Leeds', monthly: 320 },
  ];

  // CC Hair & Beauty branch coordinates (Chapeltown as primary)
  const lat = 53.8189, lng = -1.5299;

  try {
    // Fetch nearby competitors once
    const nearbyUrl = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=5000&type=beauty_salon&keyword=hair+beauty+afro&key=${placesKey}`;
    const nearbyR = await fetch(nearbyUrl);
    const nearbyData = await nearbyR.json();

    const competitors = (nearbyData.results || [])
      .filter(p => !p.name.toLowerCase().includes('cc hair'))
      .slice(0, 8)
      .map(p => ({
        name: p.name,
        address: p.vicinity,
        rating: p.rating || 0,
        reviewCount: p.user_ratings_total || 0,
        placeId: p.place_id,
        lat: p.geometry?.location?.lat,
        lng: p.geometry?.location?.lng,
      }));

    // Fetch map pack results for each query
    const mapPack = [];
    for (const q of queries.slice(0, 3)) {
      const searchUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(q.term)}&location=${lat},${lng}&radius=10000&key=${placesKey}`;
      const sr = await fetch(searchUrl);
      const sd = await sr.json();
      const results = (sd.results || []).slice(0, 3).map((p, i) => ({
        position: i + 1,
        name: p.name,
        rating: p.rating || 0,
        reviews: p.user_ratings_total || 0,
        isYou: p.name.toLowerCase().includes('cc hair'),
      }));
      const youInPack = results.some(r => r.isYou);
      mapPack.push({ query: q.term, monthly: q.monthly, results, youInPack });
    }

    res.json({ competitors, mapPack, cached: new Date().toISOString() });

  } catch (err) {
    console.error('Competitors error:', err.message);
    res.status(500).json({ error: err.message });
  }
}
