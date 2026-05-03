const PROXY_URL = "https://nutshell-peach.vercel.app/api/summarize";

const MAX_CACHE_ENTRIES = 50;
const TRACKING_PARAMS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "gclid",
  "fbclid",
  "ref",
  "source",
  "mc_cid",
  "mc_eid",
];

const MESSAGE = {
  SUMMARIZE: "SUMMARIZE",
};

chrome.runtime.onInstalled.addListener((details) => {
  console.log("[Nutshell] installed", details.reason);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== MESSAGE.SUMMARIZE) return false;

  handleSummarize(message)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((err) => sendResponse({ ok: false, error: errorMessage(err) }));

  return true;
});

async function handleSummarize({ tabId, mode = "default" }) {
  if (typeof tabId !== "number") throw new Error("Missing tabId");

  const tab = await chrome.tabs.get(tabId);
  const key = cacheKey(tab.url, mode);

  const cached = await getCached(key);
  if (cached) return { ...cached, cached: true };

  const extracted = await extractFromTab(tabId);
  if (!extracted || !extracted.text || extracted.text.length < 100) {
    throw new Error("Couldn't find readable content on this page.");
  }

  const summary = await fetchSummary(extracted, mode);
  await setCached(key, summary);
  return summary;
}

async function extractFromTab(tabId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content/vendor/readability.js", "content/extract.js"],
  });
  return results?.[results.length - 1]?.result ?? null;
}

async function fetchSummary(extracted, mode) {
  const readingTime = Math.max(1, Math.round(extracted.wordCount / 220));

  let resp;
  try {
    resp = await fetch(PROXY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: extracted.text,
        title: extracted.title,
        mode,
      }),
    });
  } catch (err) {
    throw new Error(`Couldn't reach proxy: ${err?.message || err}`);
  }

  let data = null;
  try {
    data = await resp.json();
  } catch {
    throw new Error(`Proxy returned non-JSON (status ${resp.status}).`);
  }

  if (!resp.ok) {
    throw new Error(data?.error || `Proxy error ${resp.status}.`);
  }

  return {
    title: extracted.title,
    siteName: extracted.siteName,
    byline: extracted.byline,
    method: extracted.method,
    truncated: extracted.truncated,
    wordCount: extracted.wordCount,
    readingTime,
    bullets: Array.isArray(data.bullets) ? data.bullets : [],
    insights: Array.isArray(data.insights) ? data.insights : [],
    model: data.model,
  };
}

function cacheKey(url, mode) {
  try {
    const u = new URL(url);
    u.hash = "";
    for (const p of TRACKING_PARAMS) u.searchParams.delete(p);
    return `${u.toString()}::${mode}`;
  } catch {
    return `${url}::${mode}`;
  }
}

async function getCached(key) {
  const { cache = {} } = await chrome.storage.local.get("cache");
  return cache[key]?.summary ?? null;
}

async function setCached(key, summary) {
  const { cache = {} } = await chrome.storage.local.get("cache");
  delete cache[key];
  cache[key] = { summary, cachedAt: Date.now() };
  const keys = Object.keys(cache);
  if (keys.length > MAX_CACHE_ENTRIES) {
    for (const k of keys.slice(0, keys.length - MAX_CACHE_ENTRIES)) {
      delete cache[k];
    }
  }
  await chrome.storage.local.set({ cache });
}

self.nutshell = {
  clearCache: () => chrome.storage.local.remove("cache"),
  getCache: () => chrome.storage.local.get("cache"),
};

function errorMessage(err) {
  if (!err) return "Unknown error";
  if (typeof err === "string") return err;
  return err.message || String(err);
}
