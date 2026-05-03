export const config = {
  runtime: "edge",
};

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_MODEL = "llama-3.3-70b-versatile";
const MAX_TEXT_LENGTH = 12000;
const MIN_TEXT_LENGTH = 100;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });

export default async function handler(req) {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    console.error("GROQ_API_KEY not configured");
    return json({ error: "Server is missing AI credentials." }, 500);
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  const rawText = typeof body?.text === "string" ? body.text.trim() : "";
  if (rawText.length < MIN_TEXT_LENGTH) {
    return json({ error: "Text too short to summarize." }, 400);
  }
  const text = rawText.slice(0, MAX_TEXT_LENGTH);
  const mode = body?.mode === "brief" ? "brief" : "default";
  const title = typeof body?.title === "string" ? body.title.slice(0, 200) : "";

  const model = process.env.GROQ_MODEL || DEFAULT_MODEL;

  try {
    const groqResp = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        response_format: { type: "json_object" },
        messages: buildMessages({ text, mode, title }),
      }),
    });

    if (!groqResp.ok) {
      const errText = await groqResp.text().catch(() => "");
      console.error("Groq upstream error", groqResp.status, errText.slice(0, 300));
      const status = groqResp.status === 429 ? 429 : 502;
      return json({ error: `Upstream Groq error (${groqResp.status}).` }, status);
    }

    const groqData = await groqResp.json();
    const content = groqData?.choices?.[0]?.message?.content;
    if (!content) {
      return json({ error: "Empty response from Groq." }, 502);
    }

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      return json({ error: "Groq returned invalid JSON." }, 502);
    }

    const bullets = sanitizeArray(parsed.bullets, 8, 240);
    const insights = sanitizeArray(parsed.insights, 4, 280);

    if (bullets.length === 0) {
      return json({ error: "Summary was empty." }, 502);
    }

    return json({ bullets, insights, model });
  } catch (err) {
    console.error("Proxy error", err);
    return json({ error: "Failed to reach Groq." }, 502);
  }
}

function buildMessages({ text, mode, title }) {
  const bulletInstruction =
    mode === "brief"
      ? "Return EXACTLY 3 bullets capturing only the most essential points."
      : "Return between 4 and 6 bullets that together cover the page's main content.";
  const insightsInstruction =
    mode === "brief"
      ? "Return an empty array for insights."
      : "Return 1 to 3 sharper, non-obvious takeaways a thoughtful reader would extract.";

  const system = [
    "You are an expert page summarizer.",
    "You will be given the readable text of a webpage. Produce a JSON object with two keys:",
    `- "bullets": ${bulletInstruction} Each bullet must be a complete sentence under 25 words. Do not start with "The article", "This page", "The author", or similar throat-clearing — get straight to the substance.`,
    `- "insights": ${insightsInstruction} Each insight must be one sentence under 30 words.`,
    "Output ONLY the raw JSON object — no markdown, no commentary, no code fences.",
  ].join("\n");

  const userParts = [];
  if (title) userParts.push(`Page title: ${title}`);
  userParts.push("Page text:");
  userParts.push(text);

  return [
    { role: "system", content: system },
    { role: "user", content: userParts.join("\n\n") },
  ];
}

function sanitizeArray(value, maxItems, maxCharsPerItem) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v) => typeof v === "string")
    .map((v) => v.replace(/\s+/g, " ").trim().slice(0, maxCharsPerItem))
    .filter((v) => v.length > 0)
    .slice(0, maxItems);
}
