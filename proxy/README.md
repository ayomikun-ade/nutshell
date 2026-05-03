# Nutshell Proxy

A single-function Vercel Edge proxy that forwards summarization requests from the Nutshell Chrome extension to the Groq API.

**Why a proxy?** The Groq API key must never ship with the extension — anyone with the unpacked source could read it. The proxy keeps the key server-side and only forwards sanitized requests.

## Endpoint

`POST /api/summarize`

### Request

```json
{
  "text": "string (100..12000 chars)",
  "mode": "default | brief",
  "title": "string (optional, <=200 chars)"
}
```

### Response (200)

```json
{
  "bullets": ["…", "…"],
  "insights": ["…"],
  "model": "llama-3.3-70b-versatile"
}
```

### Error responses

| Status | Cause |
|--------|-------|
| 400 | Invalid JSON body or text too short |
| 405 | Wrong HTTP method |
| 429 | Groq rate-limited the proxy |
| 500 | `GROQ_API_KEY` not configured on the server |
| 502 | Groq upstream failure or invalid model output |

## Deploy to Vercel

1. Push this repo to GitHub (or your Git host of choice).
2. In Vercel, **Add New → Project**, import the repo.
3. **Root Directory:** set to `proxy/` — this folder is the project root.
4. **Framework Preset:** *Other* (Vercel will detect the `api/` folder automatically).
5. Add environment variables:
   - `GROQ_API_KEY` — get one at https://console.groq.com/keys (free tier)
   - `GROQ_MODEL` *(optional)* — defaults to `llama-3.3-70b-versatile`
6. Deploy. You'll get a URL like `https://your-project.vercel.app`.
7. The endpoint is `https://your-project.vercel.app/api/summarize` — paste this into the extension's Options page (added in stage 5).

## Local development

```bash
cd proxy
npm i -g vercel        # if not already installed
cp .env.example .env.local
# edit .env.local and add your GROQ_API_KEY
vercel dev             # serves on http://localhost:3000
```

Test with curl:

```bash
curl -X POST http://localhost:3000/api/summarize \
  -H "Content-Type: application/json" \
  -d '{"text": "Long paragraph of webpage text that is at least one hundred characters long so it passes the minimum-length validation check on the proxy.", "mode": "brief"}'
```

## Architecture notes

- **Edge runtime.** Cold starts are a few hundred ms; total round-trip on Groq is dominated by the model call (~500–1500ms).
- **No SDK dependency.** Plain `fetch` against Groq's OpenAI-compatible Chat Completions endpoint — fewer dependencies, smaller bundle, easier to audit.
- **Structured output.** Uses Groq's `response_format: { type: "json_object" }` to guarantee parseable JSON. The output is also defensively sanitized (string filtering, length caps, item caps).
- **CORS.** `Access-Control-Allow-Origin: *` because the extension's origin is `chrome-extension://<random-id>` — wildcard is the practical choice. The proxy doesn't expose anything sensitive (no cookies, no user data flows back).

## Trade-offs / known limitations

- **No rate limiting.** Anyone who learns the proxy URL can call it and burn your Groq quota. For a local-install extension this is acceptable; for production, add per-IP throttling via Upstash Redis or Vercel KV (the proxy URL would need a stateful store since Edge functions are stateless across invocations).
- **No auth.** A shared-secret header (`X-Nutshell-Token`) baked into both the extension and the proxy env would mitigate URL-discovery attacks without adding state. Skipped for v1 to keep configuration simple.
- **Hardcoded text cap.** 12,000 chars matches the extension's extraction cap. Bigger pages get truncated client-side before they ever hit the proxy.
