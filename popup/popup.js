const $ = (sel) => document.querySelector(sel);

const els = {
  pageTitle: $("#page-title"),
  summarizeBtn: $("#summarize-btn"),
  summarizeLabel: $("#summarize-btn .btn__label"),
  clearBtn: $("#clear-btn"),
  summary: $("#summary"),
  emptyState: $("#empty-state"),
  footer: $("#footer"),
};

const state = {
  status: "idle",
  summary: null,
  error: null,
};

async function init() {
  bindEvents();
  await loadCurrentTabTitle();
  render();
}

async function loadCurrentTabTitle() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    els.pageTitle.textContent = tab?.title?.trim() || "Untitled page";
  } catch {
    els.pageTitle.textContent = "Unable to read page";
  }
}

function bindEvents() {
  els.summarizeBtn.addEventListener("click", handleSummarize);
  els.clearBtn.addEventListener("click", handleClear);
}

async function handleSummarize() {
  setState({ status: "loading", error: null });
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("No active tab.");
    if (!tab.url || !/^https?:/i.test(tab.url)) {
      throw new Error("Nutshell only works on regular web pages (http / https).");
    }

    const response = await chrome.runtime.sendMessage({
      type: "SUMMARIZE",
      tabId: tab.id,
    });

    if (!response?.ok) throw new Error(response?.error || "No response from background worker.");
    setState({ status: "success", summary: response.data });
  } catch (e) {
    setState({ status: "error", error: e?.message || String(e) });
  }
}

function handleClear() {
  setState({ status: "idle", summary: null, error: null });
  els.summarizeBtn.focus();
}

function setState(patch) {
  Object.assign(state, patch);
  render();
}

function render() {
  const isLoading = state.status === "loading";
  const hasSummary = state.status === "success" && state.summary;
  const hasError = state.status === "error";

  els.summarizeBtn.disabled = isLoading;
  els.summarizeLabel.textContent = isLoading ? "Summarizing…" : "Summarize page";
  els.summary.setAttribute("aria-busy", String(isLoading));

  els.emptyState.hidden = isLoading || hasSummary || hasError;
  els.summary.hidden = !(isLoading || hasSummary || hasError);
  els.footer.hidden = !hasSummary;

  els.summary.replaceChildren();
  if (isLoading) {
    els.summary.appendChild(loadingTemplate());
  } else if (hasError) {
    els.summary.appendChild(errorTemplate(state.error));
  } else if (hasSummary) {
    els.summary.appendChild(summaryTemplate(state.summary));
  }
}

function loadingTemplate() {
  const wrap = document.createElement("div");
  wrap.className = "loading";
  for (const mod of ["", "--medium", "--short"]) {
    const bar = document.createElement("div");
    bar.className = `loading__bar${mod ? ` loading__bar${mod}` : ""}`;
    wrap.appendChild(bar);
  }
  return wrap;
}

function errorTemplate(message) {
  const el = document.createElement("div");
  el.className = "error-card";
  el.textContent = message ?? "Something went wrong.";
  return el;
}

function summaryTemplate(summary) {
  const wrap = document.createElement("div");
  wrap.className = "summary-content";

  if (summary.readingTime) {
    const pill = document.createElement("p");
    pill.className = "pill pill--info";
    pill.textContent = `~${summary.readingTime} min read`;
    wrap.appendChild(pill);
  }

  if (summary.bullets?.length) {
    wrap.appendChild(sectionHeading("Summary"));
    wrap.appendChild(bulletList(summary.bullets));
  }

  if (summary.insights?.length) {
    wrap.appendChild(sectionHeading("Key insights"));
    wrap.appendChild(bulletList(summary.insights, "bullet-list--accent"));
  }

  return wrap;
}

function sectionHeading(text) {
  const h = document.createElement("h2");
  h.className = "summary-content__heading";
  h.textContent = text;
  return h;
}

function bulletList(items, modifier = "") {
  const ul = document.createElement("ul");
  ul.className = `bullet-list${modifier ? ` ${modifier}` : ""}`;
  for (const item of items) {
    const li = document.createElement("li");
    li.textContent = item;
    ul.appendChild(li);
  }
  return ul;
}

init();
