const PROXY_URL = "https://nutshell-peach.vercel.app/api/summarize";

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

  const extracted = await extractFromTab(tabId);
  if (!extracted || !extracted.text || extracted.text.length < 100) {
    throw new Error("Couldn't find readable content on this page.");
  }

  return fetchSummary(extracted, mode);
}

async function extractFromTab(tabId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content/vendor/readability.js", "content/extract.js"],
  });
  return results?.[results.length - 1]?.result ?? null;
}

async function fetchSummary(extracted, mode) {
  const wordCount = countWords(extracted.text);
  const readingTime = Math.max(1, Math.round(wordCount / 220));

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
    wordCount,
    readingTime,
    bullets: Array.isArray(data.bullets) ? data.bullets : [],
    insights: Array.isArray(data.insights) ? data.insights : [],
    model: data.model,
  };
}

function countWords(text) {
  return (text.match(/\S+/g) || []).length;
}

function errorMessage(err) {
  if (!err) return "Unknown error";
  if (typeof err === "string") return err;
  return err.message || String(err);
}
