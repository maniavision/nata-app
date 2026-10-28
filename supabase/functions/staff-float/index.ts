/**
 * staff-float — the money Nata holds at its payment providers, for the staff
 * dashboard on the website (nata-website, Money tab).
 *
 * Answers GET (or POST) from a signed-in staff member (nata.admins, checked
 * with am_i_admin using the caller's JWT) with:
 *   { stripe:  { mode: "live" | "test", available: [{ currency, amount }],
 *                pending: [{ currency, amount }] } | { error },
 *     pawapay: { mode: "live" | "sandbox", balances: [{ country, currency,
 *                provider?, amount }] } | { error },
 *     checked_at }
 * Amounts are in major units (dollars, not cents). Nothing is written.
 *
 * Uses the same secrets as the payment functions: STRIPE_SECRET_KEY,
 * PAWAPAY_API_URL, PAWAPAY_API_TOKEN. Browsers may call it only from the
 * website's origins (CORS below).
 *
 * Errors: 401 unauthorized (no or bad JWT), 403 not_staff.
 */

import { createClient } from "jsr:@supabase/supabase-js@2";

const ORIGINS = [
  "https://www.nata-app.com",
  "https://nata-app.com",
  "https://nata-app-five.vercel.app",
  "http://localhost:5173",
];

function cors(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  return {
    "Access-Control-Allow-Origin": ORIGINS.includes(origin) ? origin : ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(req), "Content-Type": "application/json" },
  });
}

// Stripe amounts are in the smallest unit; these currencies have none.
const ZERO_DECIMAL = new Set([
  "BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA", "PYG", "RWF",
  "UGX", "VND", "VUV", "XAF", "XOF", "XPF",
]);

function major(amount: number, currency: string): number {
  return ZERO_DECIMAL.has(currency.toUpperCase()) ? amount : amount / 100;
}

async function stripeBalance() {
  const key = Deno.env.get("STRIPE_SECRET_KEY")?.trim();
  if (!key) return { error: "not_configured" };
  try {
    const res = await fetch("https://api.stripe.com/v1/balance", {
      headers: { Authorization: `Bearer ${key}` },
    });
    const body = await res.json();
    if (!res.ok) return { error: body?.error?.message ?? `status ${res.status}` };
    const list = (rows: { amount: number; currency: string }[] = []) =>
      rows.map((r) => ({ currency: r.currency.toUpperCase(), amount: major(r.amount, r.currency) }));
    return {
      mode: key.startsWith("sk_live") || key.startsWith("rk_live") ? "live" : "test",
      available: list(body.available),
      pending: list(body.pending),
    };
  } catch (e) {
    return { error: `unreachable: ${e instanceof Error ? e.message : e}` };
  }
}

async function pawapayBalances() {
  const token = Deno.env.get("PAWAPAY_API_TOKEN")?.trim();
  if (!token) return { error: "not_configured" };
  const api = (Deno.env.get("PAWAPAY_API_URL")?.trim() || "https://api.sandbox.pawapay.io").replace(/\/+$/, "");
  try {
    const res = await fetch(`${api}/v2/wallet-balances`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) return { error: body?.failureReason?.failureMessage ?? body?.message ?? `status ${res.status}` };
    const rows = Array.isArray(body) ? body : (body?.balances ?? body?.data ?? []);
    return {
      mode: api.includes("sandbox") ? "sandbox" : "live",
      balances: rows.map((r: Record<string, unknown>) => ({
        country: r.country ?? null,
        currency: String(r.currency ?? "").toUpperCase(),
        provider: r.provider ?? r.mno ?? null,
        amount: Number(r.balance ?? r.amount ?? 0),
      })),
    };
  } catch (e) {
    return { error: `unreachable: ${e instanceof Error ? e.message : e}` };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });

  const authorization = req.headers.get("Authorization");
  if (!authorization) return json(req, { error: "unauthorized" }, 401);

  // Ask as the caller: am_i_admin answers for the signed-in user only.
  const asCaller = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const { data: staff, error } = await asCaller.rpc("am_i_admin");
  if (error) return json(req, { error: "unauthorized" }, 401);
  if (staff !== true) return json(req, { error: "not_staff" }, 403);

  const [stripe, pawapay] = await Promise.all([stripeBalance(), pawapayBalances()]);
  return json(req, { stripe, pawapay, checked_at: new Date().toISOString() });
});
