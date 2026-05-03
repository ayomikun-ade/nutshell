(() => {
  const MIN_TEXT_LENGTH = 200;

  function extractWithReadability() {
    if (typeof Readability !== "function") return null;
    try {
      const docClone = document.cloneNode(true);
      const article = new Readability(docClone, { charThreshold: 200 }).parse();
      if (!article) return null;
      const text = (article.textContent || "").replace(/\s+/g, " ").trim();
      if (text.length < MIN_TEXT_LENGTH) return null;
      return {
        method: "readability",
        title: article.title || document.title,
        byline: article.byline || null,
        siteName: article.siteName || location.hostname,
        excerpt: article.excerpt || text.slice(0, 200),
        text,
      };
    } catch {
      return null;
    }
  }

  function extractWithHeuristics() {
    const selectors = [
      "article",
      "main",
      '[role="main"]',
      "#main",
      "#content",
      ".content",
      ".post",
      ".article",
      ".article-body",
      ".story",
      ".entry-content",
    ];

    let root = null;
    let bestLen = 0;
    for (const sel of selectors) {
      try {
        for (const el of document.querySelectorAll(sel)) {
          const len = (el.innerText || "").length;
          if (len > bestLen) {
            root = el;
            bestLen = len;
          }
        }
      } catch {
        /* invalid selector — skip */
      }
    }

    if (!root) {
      for (const el of document.body.querySelectorAll("div, section")) {
        const len = (el.innerText || "").length;
        if (len > bestLen && len < 50000) {
          root = el;
          bestLen = len;
        }
      }
    }

    if (!root) root = document.body;

    const cloned = root.cloneNode(true);
    const strip = [
      "nav",
      "aside",
      "footer",
      "header",
      "script",
      "style",
      "noscript",
      "iframe",
      "form",
      "button",
      '[role="navigation"]',
      '[role="banner"]',
      '[role="contentinfo"]',
      ".advert",
      ".ad",
      ".ads",
      ".ad-container",
      ".sidebar",
      ".comments",
      ".related",
    ];
    for (const sel of strip) {
      try {
        cloned.querySelectorAll(sel).forEach((el) => el.remove());
      } catch {
        /* invalid selector */
      }
    }

    const text = (cloned.innerText || "").replace(/\s+/g, " ").trim();
    return {
      method: "heuristic",
      title: document.title,
      byline: null,
      siteName: location.hostname,
      excerpt: text.slice(0, 200),
      text,
    };
  }

  const result = extractWithReadability() || extractWithHeuristics();
  result.url = location.href;
  result.wordCount = (result.text.match(/\S+/g) || []).length;
  return result;
})();
