// POST /api/tab/save  { tab_id, spot, cart }
// Robust upsert save. Always includes `spot` to satisfy NOT NULL.
export async function onRequestPost({ request, env }) {
  const { tab_id, spot, cart } = await request.json();

  if (!tab_id || !spot || !Array.isArray(cart)) {
    return new Response("Missing tab_id, spot, or cart[]", { status: 400 });
  }

  const url = `${env.SUPABASE_URL}/rest/v1/tabs?on_conflict=id`;

  const row = {
    id: tab_id,
    spot,                 // <-- important for first-time insert
    status: "open",
    cart,
    updated_at: new Date().toISOString()
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal"
    },
    body: JSON.stringify([row])
  });

  if (!resp.ok && resp.status !== 204) {
    const txt = await resp.text();
    return new Response(`Save failed: ${txt}`, { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json" }
  });
}
