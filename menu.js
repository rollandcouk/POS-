// GET /api/menu -> returns menu items grouped by category
export async function onRequestGet({ env }) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/menu?active=eq.true&select=*`, {
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`
    }
  });

  if (!res.ok) {
    const text = await res.text();
    return new Response("DB error: " + text, { status: 500 });
  }

  const items = await res.json();

  // Group by category
  const grouped = {};
  for (const item of items) {
    if (!grouped[item.category]) grouped[item.category] = [];
    grouped[item.category].push(item);
  }

  // Sort inside categories
  for (const cat in grouped) {
    grouped[cat].sort((a, b) => a.sort - b.sort);
  }

  return new Response(JSON.stringify(grouped), {
    headers: { "Content-Type": "application/json" }
  });
}
