const $ = (sel) => document.querySelector(sel);

const els = {
  pageTitle: $("#page-title"),
  summarizeBtn: $("#summarize-btn"),
  summarizeLabel: $("#summarize-btn .btn__label"),
  clearBtn: $("#clear-btn"),
  summary: $("#summary"),
  emptyState: $("#empty-state"),
  footer: $("#footer"),
  modeBtns: document.querySelectorAll(".mode-btn"),
};

const state = {
  status: "idle",
  summary: null,
  error: null,
  mode: "default",
};

async function init() {
  await loadMode();
  bindEvents();
  await loadCurrentTabTitle();
  render();
}

async function loadMode() {
  const { mode } = await chrome.storage.local.get("mode");
  if (mode === "brief" || mode === "default") state.mode = mode;
  applyModeToUI();
}

function applyModeToUI() {
  els.modeBtns.forEach((btn) => {
    btn.setAttribute("aria-pressed", String(btn.dataset.mode === state.mode));
  });
}

async function handleModeChange(mode) {
  if (mode !== "default" && mode !== "brief") return;
  if (mode === state.mode) return;
  state.mode = mode;
  applyModeToUI();
  await chrome.storage.local.set({ mode });
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
  els.modeBtns.forEach((btn) => {
    btn.addEventListener("click", () => handleModeChange(btn.dataset.mode));
  });
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
      mode: state.mode,
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

  const meta = document.createElement("div");
  meta.className = "summary-meta";

  const pills = document.createElement("div");
  pills.className = "summary-meta__pills";

  const metaParts = [];
  if (summary.readingTime) metaParts.push(`${summary.readingTime} min read`);
  if (summary.wordCount) metaParts.push(`${summary.wordCount.toLocaleString()} words`);
  if (metaParts.length) {
    const info = document.createElement("span");
    info.className = "pill pill--info";
    info.textContent = metaParts.join(" · ");
    pills.appendChild(info);
  }
  if (summary.cached) {
    const cached = document.createElement("span");
    cached.className = "pill pill--cached";
    cached.textContent = "Cached";
    pills.appendChild(cached);
  }
  meta.appendChild(pills);
  meta.appendChild(copyButton(summary));
  wrap.appendChild(meta);

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

function copyButton(summary) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn btn--small";
  btn.textContent = "Copy";
  btn.addEventListener("click", () => handleCopy(summary, btn));
  return btn;
}

async function handleCopy(summary, btn) {
  const text = formatSummaryAsText(summary);
  const original = btn.textContent;
  try {
    await navigator.clipboard.writeText(text);
    btn.textContent = "Copied";
    btn.disabled = true;
  } catch {
    btn.textContent = "Failed";
  }
  setTimeout(() => {
    btn.textContent = original;
    btn.disabled = false;
  }, 1500);
}

function formatSummaryAsText(summary) {
  const lines = [];
  if (summary.title) {
    lines.push(summary.title.trim(), "");
  }
  if (summary.bullets?.length) {
    lines.push("Summary");
    for (const b of summary.bullets) lines.push(`- ${b}`);
    lines.push("");
  }
  if (summary.insights?.length) {
    lines.push("Key insights");
    for (const i of summary.insights) lines.push(`- ${i}`);
  }
  return lines.join("\n").trim();
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
