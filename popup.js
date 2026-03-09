/**
 * Grok Is This Real? Checker — Popup Script
 */

const loadingEl = document.getElementById("loading");
const resultsEl = document.getElementById("results");
const scanBtn = document.getElementById("scanBtn");
const clearBtn = document.getElementById("clearBtn");

/**
 * Render results from storage into the popup.
 */
function renderResults(data) {
  loadingEl.style.display = "none";
  resultsEl.style.display = "block";

  if (!data || typeof data.count === "undefined") {
    resultsEl.innerHTML = `
      <div class="no-results">
        <span class="emoji">📭</span>
        No scan results yet.<br>
        Click a <strong>Grok?</strong> button on a tweet,<br>
        or use "Scan Current Page" below.
      </div>
    `;
    return;
  }

  const sourceLabel = data.source === "button"
    ? "Tweet button scan"
    : data.source === "contextMenu"
      ? "Context menu / full-page scan"
      : "Scan";

  const timeStr = data.timestamp
    ? new Date(data.timestamp).toLocaleTimeString()
    : "N/A";

  // Build Grok response HTML if available
  let grokHtml = "";
  if (data.grokResponse) {
    const truncated = data.grokResponse.length > 500
      ? data.grokResponse.substring(0, 500) + "\u2026"
      : data.grokResponse;
    grokHtml = `
      <div class="grok-response-card">
        <div class="label">\ud83e\udd16 Grok's Response:</div>
        <div class="text">${escapeHtml(truncated)}</div>
        ${data.grokResponseCount > 1 ? `<div class="count">${data.grokResponseCount} Grok replies found \u2014 showing most relevant</div>` : ""}
      </div>
    `;
  }

  if (data.count === 0 && !data.grokResponse) {
    resultsEl.innerHTML = `
      <div class="result-card">
        <div class="no-results">
          <span class="emoji">\u2705</span>
          No <em>"grok is this real?"</em> mentions found.
        </div>
        <div class="result-source">${sourceLabel}${data.url ? " \u2014 " + truncateUrl(data.url) : ""}</div>
      </div>
      <div class="timestamp">Last scanned at ${timeStr}</div>
    `;
    return;
  }

  let snippetsHtml = "";
  if (data.snippets && data.snippets.length > 0) {
    const items = data.snippets
      .map((s) => `<li>"${escapeHtml(s.substring(0, 140))}"</li>`)
      .join("");
    snippetsHtml = `<ul class="snippet-list">${items}</ul>`;
  }

  // Build breakdown line
  let breakdownHtml = "";
  if (typeof data.isThisRealCount !== "undefined") {
    breakdownHtml = `<div class="result-breakdown">
      \ud83c\udfaf "is this real": <strong>${data.isThisRealCount}</strong> &nbsp;|&nbsp;
      \ud83d\udcac @grok mentions: <strong>${data.grokMentionCount || 0}</strong>
    </div>`;
  }

  resultsEl.innerHTML = `
    <div class="result-card">
      <div class="result-count">
        Found <span class="highlight">${data.count}</span> match${data.count > 1 ? "es" : ""}
      </div>
      ${breakdownHtml}
      <div class="result-source">${sourceLabel}${data.url ? " \u2014 " + truncateUrl(data.url) : ""}</div>
      ${snippetsHtml}
    </div>
    ${grokHtml}
    <div class="timestamp">Last scanned at ${timeStr}</div>
  `;
}

/**
 * Truncate URL for display.
 */
function truncateUrl(url) {
  try {
    const u = new URL(url);
    const path = u.pathname.length > 30 ? u.pathname.substring(0, 30) + "\u2026" : u.pathname;
    return u.hostname + path;
  } catch {
    return url.substring(0, 40) + "\u2026";
  }
}

/**
 * Basic HTML escaping.
 */
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Load results from chrome.storage.local on popup open.
 */
function loadResults() {
  chrome.storage.local.get("grokResults", (data) => {
    renderResults(data.grokResults || null);
  });
}

/**
 * "Scan Current Page" button — send message to active tab's content script.
 */
scanBtn.addEventListener("click", () => {
  loadingEl.style.display = "flex";
  resultsEl.style.display = "none";

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]?.id) {
      renderResults(null);
      return;
    }

    chrome.tabs.sendMessage(tabs[0].id, { action: "scanPage" }, (response) => {
      if (chrome.runtime.lastError) {
        console.log("[Grok Popup] Error contacting content script:", chrome.runtime.lastError.message);

        // Fallback: inject scan script directly
        chrome.scripting.executeScript(
          {
            target: { tabId: tabs[0].id },
            func: () => {
              const patterns = [
                /grok\s+is\s+this\s+real/i,
                /@grok\s+is\s+this\s+real/i,
                /is\s+this\s+real\s+@?grok/i,
                /@grok\b/i,
              ];
              const matches = [];
              const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
              let node;
              while ((node = walker.nextNode())) {
                const text = node.textContent.trim();
                if (!text) continue;
                for (const p of patterns) {
                  if (p.test(text)) {
                    matches.push(text.substring(0, 200));
                    break;
                  }
                }
              }
              return {
                count: matches.length,
                snippets: matches.slice(0, 10),
                timestamp: Date.now(),
                source: "contextMenu",
                url: window.location.href,
              };
            },
          },
          (results) => {
            if (results && results[0]?.result) {
              chrome.storage.local.set({ grokResults: results[0].result }, () => {
                renderResults(results[0].result);
              });
            } else {
              renderResults(null);
            }
          }
        );
        return;
      }

      // Content script responded directly
      if (response) {
        renderResults(response);
      } else {
        // Response was saved to storage by content script, reload it
        setTimeout(loadResults, 300);
      }
    });
  });
});

/**
 * "Clear" button — remove stored results.
 */
clearBtn.addEventListener("click", () => {
  chrome.storage.local.remove("grokResults", () => {
    renderResults(null);
  });
});

// Listen for storage changes (live updates from content script)
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.grokResults) {
    renderResults(changes.grokResults.newValue);
  }
});

// Load on open
loadResults();
