chrome.runtime.onInstalled.addListener((details) => {
  console.log("[Nutshell] installed", details.reason);
});
