// POST /api/update_price -> update price for one item
export async function onRequestPost({ request, env }) {
  const body = await request.json();
  const { id, new_price } = body;

  // Note: a price of 0 is valid, so check for presence rather than truthiness.
  const price = Number(new_price);
  if (!id || new_price === undefined || new_price === null || !Number.isFinite(price) || price < 0) {
    return new Response("Missing or invalid id / new_price", { status: 400 });
  }

  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/menu?id=eq.${id}`, {
    method: "PATCH",
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation"
    },
    body: JSON.stringify({ price, updated_at: new Date().toISOString() })
  });

  if (!res.ok) {
    const text = await res.text();
    return new Response("DB error: " + text, { status: 500 });
  }

  const data = await res.json();
  return new Response(JSON.stringify(data[0]), { headers: { "Content-Type": "application/json" }});
}
