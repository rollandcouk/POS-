// POST /api/tab/open { spot } -> returns { tab_id, spot, cart }
export async function onRequestPost({ request, env }) {
  const { spot } = await request.json();
  if (!spot) return new Response("Missing spot", { status: 400 });

  // 1) Get the latest open tab for this spot
  const url =
    `${env.SUPABASE_URL}/rest/v1/tabs` +
    `?spot=eq.${encodeURIComponent(spot)}` +
    `&status=eq.open` +
    `&select=id,spot,cart,updated_at` +
    `&order=updated_at.desc&limit=1`;

  const q = await fetch(url, {
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      Accept: "application/json"
    }
  });

  if (!q.ok) return new Response(await q.text(), { status: 500 });
  const rows = await q.json();

  if (rows.length > 0) {
    const t = rows[0];
    // Coerce cart to a JS array in case it arrives as a JSON string/null
    const cart = toCartArray(t.cart);
    return json({ tab_id: t.id, spot: t.spot, cart });
  }

  // 2) Create new open tab for this spot
  const tab_id = crypto.randomUUID();
  const create = await fetch(`${env.SUPABASE_URL}/rest/v1/tabs`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation"
    },
    body: JSON.stringify([{ id: tab_id, spot, status: "open", cart: [] }])
  });
  if (!create.ok) return new Response(await create.text(), { status: 500 });
  const [t] = await create.json();
  return json({ tab_id: t.id, spot: t.spot, cart: [] });
}

function toCartArray(val) {
  if (Array.isArray(val)) return val;
  if (val == null) return [];
  try {
    const parsed = typeof val === "string" ? JSON.parse(val) : val;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function json(obj) {
  return new Response(JSON.stringify(obj), { headers: { "Content-Type": "application/json" } });
}
