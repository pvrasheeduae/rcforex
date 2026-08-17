/**
 * Rock Champ Forex Trading — AI Proxy Worker (Gemini backend)
 * ============================================================
 * Deploy this to Cloudflare Workers (free tier: 100,000 requests/day)
 * to give EVERY visitor to your dashboard access to the AI Insight
 * features — without each person needing their own Gemini API key.
 *
 * Your real API key lives only here, as a server-side secret. It is
 * never sent to the browser, never visible in page source, never
 * exposed in the dashboard's HTML.
 *
 * WHAT THIS DOES:
 *   Browser → this Worker → generativelanguage.googleapis.com → this Worker → Browser
 * The browser only ever talks to your Worker's URL. Your Worker adds
 * the real API key server-side before forwarding to Gemini.
 *
 * Gemini was chosen specifically because Google AI Studio gives it a
 * genuine $0 free tier — no credit card required to start, unlike
 * most model APIs. This Worker's own hosting (Cloudflare) is also free.
 *
 * DEPLOYMENT (one-time setup, ~10 minutes):
 *   1. Create a free account at https://dash.cloudflare.com/sign-up
 *   2. Install Wrangler (Cloudflare's CLI):
 *        npm install -g wrangler
 *   3. From this folder, log in:
 *        wrangler login
 *   4. Get a free Gemini API key at https://aistudio.google.com/apikey,
 *      then set it as a secret (you'll be prompted to paste it — it is
 *      NOT written to any file, stored encrypted by Cloudflare):
 *        wrangler secret put GEMINI_API_KEY
 *   5. Edit ALLOWED_ORIGINS below to match wherever you host the
 *      dashboard (e.g. "https://yourdomain.com", or your GitHub
 *      Pages / Netlify / Vercel URL).
 *   6. Deploy:
 *        wrangler deploy
 *   7. Wrangler will print a URL like:
 *        https://rcf-ai-proxy.YOUR-SUBDOMAIN.workers.dev
 *      That's your backend's live URL.
 *   8. In the dashboard's index.html, find CONFIG.AI_PROXY_URL near
 *      the top of the <script> section and paste that URL in. Every
 *      visitor's AI button will now work automatically — no per-user
 *      key needed.
 *
 * COST: Cloudflare Workers free tier covers 100,000 requests/day.
 * Gemini's free tier covers a generous number of requests/day per
 * Google Cloud project (limits vary by model — check the live numbers
 * for your project at https://aistudio.google.com). The rate limit
 * below is a basic safety net on top of that, not a guarantee you'll
 * never brush against Google's own free-tier ceiling under heavy use.
 * ============================================================
 */

// --- Configure these two things before deploying ---
const ALLOWED_ORIGINS = [
  "https://yourdomain.com",       // <-- REPLACE with wherever you host the dashboard
  // "http://localhost:8000",     // <-- uncomment while testing locally
];
const RATE_LIMIT_PER_MINUTE = 5;  // requests allowed per visitor IP, per minute
const GEMINI_MODEL = "gemini-3.6-flash"; // update here if Google renames/retires this alias later

// In-memory rate limiter. Resets whenever this Worker instance cold-starts
// (Cloudflare may spin up multiple instances across regions), so treat
// this as basic abuse deterrence, not a hard cap — for a hard cap at
// scale, swap this for Cloudflare's Durable Objects or KV-based limiting.
const rateLimitMap = new Map();

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function isRateLimited(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now - entry.windowStart > 60000) {
    rateLimitMap.set(ip, { count: 1, windowStart: now });
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT_PER_MINUTE;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(origin) });
    }
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405, headers: corsHeaders(origin) });
    }

    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    if (isRateLimited(ip)) {
      return new Response(
        JSON.stringify({ error: "Rate limit exceeded — please wait a minute and try again." }),
        { status: 429, headers: { ...corsHeaders(origin), "Content-Type": "application/json" } }
      );
    }

    let body;
    try {
      body = await request.json();
    } catch (e) {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
        status: 400,
        headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
      });
    }

    // Only forward the fields the dashboard actually needs. The client
    // can suggest a prompt/maxTokens, but everything is clamped/shaped
    // here — it can never override the API key or smuggle in arbitrary
    // params to the upstream Gemini call.
    const prompt = typeof body.prompt === "string" ? body.prompt : "";
    const maxTokens = Math.min(Number(body.maxTokens) || 500, 1200);

    if (!prompt) {
      return new Response(JSON.stringify({ error: "prompt is required" }), {
        status: 400,
        headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
      });
    }

    const upstreamBody = {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: maxTokens },
    };

    const upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": env.GEMINI_API_KEY, // set via: wrangler secret put GEMINI_API_KEY
        },
        body: JSON.stringify(upstreamBody),
      }
    );

    // Passed straight through — the dashboard's extractGeminiText() parses
    // this same shape whether it came from this proxy or a direct call.
    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });
  },
};
