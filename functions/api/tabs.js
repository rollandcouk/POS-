// GET /api/tabs -> list open tabs with item_count & subtotal (computed from cart)
//   `since` powers the "open for 22m" timer on the Floor view. We select *
//   so the column set isn't assumed — created_at is used when present, and
//   updated_at is the fallback.
export async function onRequestGet({ env }) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/tabs?status=eq.open&select=*`, {
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`
    }
  });
  if (!r.ok) return new Response(await r.text(), { status: 500 });

  const rows = await r.json();
  const out = rows.map(t => {
    let item_count = 0, subtotal = 0;
    for (const it of toArray(t.cart)) {
      item_count += Number(it.qty || 0);
      subtotal += Number(it.qty || 0) * Number(it.price || 0);
    }
    return {
      tab_id: t.id,
      spot: t.spot,
      item_count,
      subtotal: Math.round(subtotal * 100) / 100,
      updated_at: t.updated_at ?? null,
      since: t.created_at ?? t.opened_at ?? t.updated_at ?? null
    };
  });

  return new Response(JSON.stringify(out), {
    headers: { "Content-Type": "application/json" }
  });
}

function toArray(v) {
  if (Array.isArray(v)) return v;
  if (v == null) return [];
  try { const p = typeof v === "string" ? JSON.parse(v) : v; return Array.isArray(p) ? p : []; }
  catch { return []; }
}
