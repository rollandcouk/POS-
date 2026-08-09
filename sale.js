// POST /api/sale
//   Writes ONE row to public.orders AND line items to public.sales.
//   Add ?format=json to get a JSON summary back instead of an HTML receipt —
//   the POS uses that so it can show a receipt overlay without reloading itself.
export async function onRequestPost({ request, env }) {
  try {
    const url = new URL(request.url);
    const wantsJson =
      url.searchParams.get("format") === "json" ||
      (request.headers.get("accept") || "").includes("application/json");

    const body = await request.json();
    const {
      cart,
      payment_method,
      staff,
      amount_received,
      discount_type = null,
      discount_value = 0,
      discount_amount = 0
    } = body;

    if (!Array.isArray(cart) || cart.length === 0) {
      return new Response("Cart is empty", { status: 400 });
    }
    if (!payment_method || !staff) {
      return new Response("Missing payment_method or staff", { status: 400 });
    }

    const order_id = crypto.randomUUID();
    const nowIso = new Date().toISOString();

    // Recompute from the cart — never trust client-side totals.
    const gross = cart.reduce((s, i) => s + Number(i.price || 0) * Number(i.qty || 0), 0);
    const discount = clampDiscount(discount_type, discount_value, discount_amount, gross);
    const subtotal = round2(Math.max(0, gross - discount));
    const received = Number(amount_received || 0);
    const change_due = received > 0 ? round2(Math.max(0, received - subtotal)) : 0;
    const item_count = cart.reduce((s, i) => s + Number(i.qty || 0), 0);

    // 1) Insert the order summary
    const base = {
      id: order_id,
      subtotal,
      amount_received: received,
      change_due,
      item_count,
      payment_method,
      staff,
      cart
    };
    // Extra analytics columns — only kept if the table actually has them.
    const extended = {
      ...base,
      gross_subtotal: round2(gross),
      discount_amount: round2(discount),
      discount_type: discount > 0 ? discount_type : null,
      discount_value: discount > 0 ? Number(discount_value) || 0 : 0
    };

    const ordResp = await insertOrder(env, extended, base);
    if (!ordResp.ok) {
      return new Response("DB error (orders): " + ordResp.error, { status: 500 });
    }

    // 2) Insert line items into sales
    const salesRows = cart.map(item => ({
      order_id,
      ts: nowIso,
      item: String(item.name),
      qty: Number(item.qty),
      price: Number(item.price),
      payment_method: String(payment_method),
      staff: String(staff),
      amount_received: received,
      change_due
    }));

    const salesResp = await fetch(`${env.SUPABASE_URL}/rest/v1/sales`, {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal"
      },
      body: JSON.stringify(salesRows)
    });

    if (!salesResp.ok) {
      // Cleanup: remove the order row so we don't leave an orphan
      await fetch(`${env.SUPABASE_URL}/rest/v1/orders?id=eq.${order_id}`, {
        method: "DELETE",
        headers: {
          apikey: env.SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`
        }
      });
      const text = await salesResp.text();
      return new Response("DB error (sales): " + text, { status: 500 });
    }

    const summary = {
      order_id,
      subtotal,
      gross_subtotal: round2(gross),
      discount_amount: round2(discount),
      item_count,
      amount_received: received,
      change_due,
      payment_method,
      staff,
      ts: nowIso
    };

    if (wantsJson) {
      return new Response(JSON.stringify(summary), {
        headers: { "Content-Type": "application/json" }
      });
    }

    return new Response(renderReceipt(summary, cart), {
      headers: { "Content-Type": "text/html; charset=utf-8" }
    });

  } catch (e) {
    return new Response("Server error: " + e.message, { status: 500 });
  }
}

/* ── helpers ─────────────────────────────────────────────── */

const round2 = n => Math.round((Number(n) || 0) * 100) / 100;

function clampDiscount(type, value, amount, gross) {
  let d = Number(amount) || 0;
  // Fall back to recomputing from type+value if amount wasn't supplied.
  if (!d && type) {
    d = type === "pct" ? gross * (Number(value) || 0) / 100 : Number(value) || 0;
  }
  return Math.max(0, Math.min(d, gross));
}

// Insert with the richer column set; if this schema doesn't have those
// columns yet, transparently fall back to the original set.
async function insertOrder(env, extended, base) {
  const post = row => fetch(`${env.SUPABASE_URL}/rest/v1/orders`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal"
    },
    body: JSON.stringify([row])
  });

  let res = await post(extended);
  if (res.ok) return { ok: true };

  const text = await res.text();
  if (isMissingColumn(text)) {
    res = await post(base);
    if (res.ok) return { ok: true };
    return { ok: false, error: await res.text() };
  }
  return { ok: false, error: text };
}

function isMissingColumn(text) {
  const t = String(text).toLowerCase();
  return t.includes("pgrst204") ||
         (t.includes("column") &&
          (t.includes("does not exist") || t.includes("not found") || t.includes("schema cache")));
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function money(n) { return "£" + (Math.round((Number(n) || 0) * 100) / 100).toFixed(2); }

function renderReceipt(o, cart) {
  const when = new Date(o.ts).toLocaleString("en-GB", { hour12: false });
  const lines = cart.map(i => `
    <tr>
      <td>${i.qty}&times; ${esc(i.name)}${i.note ? `<div class="n">&#8627; ${esc(i.note)}</div>` : ""}</td>
      <td class="r">${money(Number(i.price) * Number(i.qty))}</td>
    </tr>`).join("");

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Receipt — Roll &amp; Co.</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  :root{--ink:#1B1613;--muted:#8C7E72;--line:#EADFD2}
  body{font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;
       margin:0;padding:24px;color:var(--ink);background:#FAF7F3}
  .wrap{max-width:420px;margin:0 auto;background:#fff;border:1px solid var(--line);
        border-radius:16px;padding:22px;box-shadow:0 10px 30px rgba(120,70,20,.10)}
  h1{margin:0;font-size:1.15rem;text-align:center;
     background:linear-gradient(135deg,#FF3B00,#FF7A00 55%,#FFC107);
     -webkit-background-clip:text;background-clip:text;color:transparent}
  .meta{text-align:center;color:var(--muted);font-size:.82rem;margin:6px 0 16px}
  table{width:100%;border-collapse:collapse}
  td{padding:6px 0;vertical-align:top;font-size:.92rem}
  .n{font-size:.78rem;color:#FF7A00;padding-left:12px}
  .r{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
  .sep{border-top:1px dashed var(--line);margin:12px 0}
  .tot td{font-weight:800;font-size:1.1rem}
  .foot{text-align:center;color:var(--muted);font-size:.82rem;margin-top:16px}
  .actions{display:flex;gap:8px;max-width:420px;margin:16px auto 0}
  .actions button{flex:1;padding:14px;border:none;border-radius:12px;font-weight:800;cursor:pointer;font-size:.95rem}
  .print{background:#241F1C;color:#fff}
  .new{background:linear-gradient(135deg,#FF3B00,#FF7A00 55%,#FFC107);color:#1A0C00}
  @media print{.actions{display:none}body{background:#fff;padding:0}.wrap{border:none;box-shadow:none}}
</style></head>
<body>
  <div class="wrap">
    <h1>Roll &amp; Co.</h1>
    <div class="meta">${when}<br>#${esc(String(o.order_id).slice(0, 8))}</div>
    <table>${lines}</table>
    <div class="sep"></div>
    <table>
      <tr><td>Subtotal</td><td class="r">${money(o.gross_subtotal)}</td></tr>
      ${o.discount_amount > 0 ? `<tr><td>Discount</td><td class="r">-${money(o.discount_amount)}</td></tr>` : ""}
      <tr class="tot"><td>Total</td><td class="r">${money(o.subtotal)}</td></tr>
      <tr><td>${esc(o.payment_method)}</td><td class="r">${o.amount_received > 0 ? money(o.amount_received) : money(o.subtotal)}</td></tr>
      ${o.amount_received > 0 ? `<tr><td>Change</td><td class="r">${money(o.change_due)}</td></tr>` : ""}
    </table>
    <div class="foot">Served by ${esc(o.staff)}<br>Thanks for visiting Roll &amp; Co.!</div>
  </div>
  <div class="actions">
    <button class="print" onclick="window.print()">🖨️ Print</button>
    <button class="new" onclick="location.href='/'">New order</button>
  </div>
</body></html>`;
}
