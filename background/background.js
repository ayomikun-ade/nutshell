const MESSAGE = {
  SUMMARIZE: "SUMMARIZE",
};

chrome.runtime.onInstalled.addListener((details) => {
  console.log("[Nutshell] installed", details.reason);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== MESSAGE.SUMMARIZE) return false;

  handleSummarize(message.tabId)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((err) => sendResponse({ ok: false, error: errorMessage(err) }));

  return true;
});

async function handleSummarize(tabId) {
  if (typeof tabId !== "number") throw new Error("Missing tabId");

  const extracted = await extractFromTab(tabId);
  if (!extracted || !extracted.text || extracted.text.length < 100) {
    throw new Error("Couldn't find readable content on this page.");
  }

  return buildLocalSummary(extracted);
}

async function extractFromTab(tabId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content/vendor/readability.js", "content/extract.js"],
  });
  return results?.[results.length - 1]?.result ?? null;
}

function buildLocalSummary(extracted) {
  const wordCount = countWords(extracted.text);
  const readingTime = Math.max(1, Math.round(wordCount / 220));
  const bullets = splitSentences(extracted.text).slice(0, 4);

  return {
    title: extracted.title,
    siteName: extracted.siteName,
    byline: extracted.byline,
    method: extracted.method,
    truncated: extracted.truncated,
    wordCount,
    readingTime,
    bullets,
    insights: ["AI insights arrive in stage 5 once the proxy is wired up."],
  };
}

function splitSentences(text) {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'])/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length > 30);
}

function countWords(text) {
  return (text.match(/\S+/g) || []).length;
}

function errorMessage(err) {
  if (!err) return "Unknown error";
  if (typeof err === "string") return err;
  return err.message || String(err);
}
