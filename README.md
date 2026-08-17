# Rock Champ Forex Trading — AI Proxy Backend

This is the missing piece for making the dashboard's AI features (AI Market
Insight, AI Gold Insight) work for **every visitor**, not just people who've
pasted in their own Gemini API key.

## Why this exists

The dashboard is a single static HTML file with no server. That's great
for simplicity, but it means there's nowhere safe to keep a real API key —
anything in the HTML is visible to anyone who views the page source. This
Worker is that missing server: a tiny, free-tier-friendly backend whose
only job is to hold your Gemini API key securely and forward requests to
it on the dashboard's behalf.

```
Visitor's browser  →  this Worker  →  generativelanguage.googleapis.com
                   ←               ←
```

The browser never sees your real key. It only ever talks to your Worker's
public URL.

## Why Gemini

The dashboard's AI features run on Google's Gemini API specifically
because it has a genuine **$0 free tier** — no credit card required to
start, unlike most model APIs. That keeps the whole stack (Cloudflare
Workers free tier + Gemini free tier) free to run for light/personal use.

## Deploy it (about 10 minutes)

1. Free Cloudflare account: https://dash.cloudflare.com/sign-up
2. `npm install -g wrangler`
3. `wrangler login`
4. Get a free Gemini API key at https://aistudio.google.com/apikey
5. From this folder: `wrangler secret put GEMINI_API_KEY` — paste your
   real key when prompted. It's encrypted by Cloudflare, never written to
   a file here.
6. Open `worker.js` and edit `ALLOWED_ORIGINS` to the domain you'll host
   the dashboard on.
7. `wrangler deploy`
8. Copy the URL Wrangler prints (looks like
   `https://rcf-ai-proxy.YOUR-SUBDOMAIN.workers.dev`).
9. In the dashboard's `index.html`, find `CONFIG.AI_PROXY_URL` near the
   top of the `<script>` block and paste that URL in.

That's it — every visitor's AI buttons now work with no per-user setup.

## Cost

- Cloudflare Workers free tier: 100,000 requests/day, no card required.
- Gemini API free tier: a genuine no-cost tier tied to whichever Google
  Cloud project owns the key you set in step 5 — check the live numbers
  for your project at https://aistudio.google.com if you expect meaningful
  traffic. `RATE_LIMIT_PER_MINUTE` in `worker.js` is a basic per-visitor
  throttle, not a guarantee you'll never brush against Google's own
  free-tier ceiling under heavy use.

## Security notes

- `ALLOWED_ORIGINS` restricts which websites can call this Worker —
  set it correctly or anyone could point their own site at your key.
- The Worker only forwards the `prompt` and `maxTokens` fields the client
  sends (clamped and reshaped server-side) and ignores everything else, so
  a malicious request can't smuggle in different parameters.
- If you ever suspect the key has leaked, rotate it at
  aistudio.google.com and run `wrangler secret put GEMINI_API_KEY`
  again with the new one — no redeploy of the dashboard needed.
