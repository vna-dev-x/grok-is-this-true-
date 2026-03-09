/**
 * Grok Is This Real? Checker — Background Service Worker
 * Handles context menu only. API calls are made by content script (same-origin).
 */

// ─── Create context menu on install ────────────────────────────────────
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "grok-check-page",
    title: "Check if 'Grok is this real?' is in comments",
    contexts: ["page", "selection"],
  });
  console.log("[Grok BG] Context menu created.");
});

// ─── Handle context menu clicks ────────────────────────────────────────
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "grok-check-page" && tab?.id) {
    chrome.tabs.sendMessage(tab.id, { action: "scanPage" }, (response) => {
      if (chrome.runtime.lastError) {
        console.log("[Grok BG] Content script unavailable for context menu scan.");
      }
    });
  }
});
