/**
 * Grok Is This Real? Checker — Content Script (ISOLATED world)
 * Injects buttons, sends postMessage to inject.js (MAIN world) for API calls,
 * receives raw JSON back and parses it here.
 */

(function () {
  "use strict";

  const BUTTON_CLASS = "grok-check-btn";
  const TWEET_SELECTOR = 'article[data-testid="tweet"]';

  const ACTION_BAR_SELECTORS = [
    'div[role="group"][id]',
    'div[role="group"][aria-label]',
    'div[data-testid="reply"]',
  ];

  const ICON_SVG = `
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none"
         stroke="currentColor" stroke-width="2" stroke-linecap="round"
         stroke-linejoin="round" class="grok-check-icon">
      <circle cx="12" cy="12" r="10"/>
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
      <line x1="12" y1="17" x2="12.01" y2="17"/>
    </svg>`;

  const SPINNER_SVG = `
    <svg viewBox="0 0 24 24" width="18" height="18" class="grok-check-icon grok-spinner">
      <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor"
              stroke-width="2" stroke-dasharray="31.4 31.4" stroke-linecap="round"/>
    </svg>`;

  // ─── Patterns ──────────────────────────────────────────────────────────
  const IS_THIS_REAL = [
    /grok\s+is\s+this\s+real/i,
    /@grok\s+is\s+this\s+real/i,
    /is\s+this\s+real\s+@?grok/i,
  ];
  const GROK_MENTION = [
    /@grok\b/i,
    /\bgrok\b.*\b(is this|real|true|fake|fact.?check)/i,
  ];
  const RELEVANCE_KW = [
    /\b(true|false|real|fake|misleading|accurate|inaccurate)\b/i,
    /\b(verified|unverified|confirm|debunk|fact.?check)\b/i,
    /\b(yes|no|correct|incorrect|partly|partially)\b/i,
  ];

  // ─── Utilities ─────────────────────────────────────────────────────────
  function findActionBar(tweetEl) {
    for (const sel of ACTION_BAR_SELECTORS) {
      const bar = tweetEl.querySelector(sel);
      if (bar) {
        if (sel.includes("data-testid")) {
          return bar.closest('div[role="group"]') || bar.parentElement?.parentElement;
        }
        return bar;
      }
    }
    return null;
  }

  function extractTweetId(tweetArticle) {
    const links = tweetArticle.querySelectorAll('a[href*="/status/"]');
    for (const link of links) {
      const href = link.getAttribute("href");
      const match = href?.match(/\/status\/(\d+)/);
      if (match) return match[1];
    }
    const timeLink = tweetArticle.querySelector("time")?.closest("a")?.getAttribute("href");
    if (timeLink) {
      const match = timeLink.match(/\/status\/(\d+)/);
      if (match) return match[1];
    }
    return null;
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // ─── Fetch via MAIN world inject.js ────────────────────────────────────
  // Pending requests map: requestId -> { resolve, reject }
  const pendingRequests = new Map();
  let nextRequestId = 1;

  // Listen for responses from inject.js
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.data?.type !== 'GROK_FETCH_RESPONSE') return;

    const { requestId, success, data, error } = event.data;
    const pending = pendingRequests.get(requestId);
    if (!pending) return;

    pendingRequests.delete(requestId);
    if (success) {
      pending.resolve(data);
    } else {
      pending.reject(new Error(error || 'Unknown error'));
    }
  });

  function fetchTweetThread(tweetId) {
    return new Promise((resolve, reject) => {
      const requestId = nextRequestId++;
      pendingRequests.set(requestId, { resolve, reject });

      // Timeout after 30s
      setTimeout(() => {
        if (pendingRequests.has(requestId)) {
          pendingRequests.delete(requestId);
          reject(new Error('Request timed out'));
        }
      }, 30000);

      console.log(`[Grok] Sending fetch request to MAIN world (req ${requestId})`);
      window.postMessage({
        type: 'GROK_FETCH_REQUEST',
        tweetId: tweetId,
        requestId: requestId
      }, '*');
    });
  }

  // ─── Parse GraphQL Response ────────────────────────────────────────────
  function parseResponse(data) {
    const grokMentionTweetIds = [];  // IDs of tweets that mention @grok
    const grokMentionTexts = [];
    const grokResponses = [];
    let totalParsed = 0;

    const instructions = data?.data?.threaded_conversation_with_injections_v2?.instructions || [];

    function processTweet(result) {
      if (!result) return;
      if (result.__typename === 'TweetWithVisibilityResults') {
        result = result.tweet;
      }
      if (!result) return;

      const userResult = result?.core?.user_results?.result;
      const screenName = userResult?.legacy?.screen_name || '';
      const fullText = result?.legacy?.full_text || '';
      const tweetId = result?.rest_id || result?.legacy?.id_str || '';

      totalParsed++;
      if (!fullText) return;

      console.log(`[Grok] 📝 @${screenName}: "${fullText.substring(0, 80)}"`);

      // Check if this tweet IS from @grok (direct Grok response)
      if (/^grok$/i.test(screenName) && fullText.length > 10) {
        grokResponses.push(fullText);
        console.log(`[Grok] 🤖 GROK RESPONSE FOUND (direct)`);
        return;
      }

      // Check if this tweet mentions @grok — save its ID + like count for second-level fetch
      for (const p of GROK_MENTION) {
        if (p.test(fullText)) {
          const likes = parseInt(result?.legacy?.favorite_count) || 0;
          if (tweetId) grokMentionTweetIds.push({ id: tweetId, likes, text: fullText.substring(0, 300) });
          grokMentionTexts.push(fullText.substring(0, 300));
          console.log(`[Grok] 💬 @grok mention in tweet ${tweetId} (${likes} likes)`);

          // DEBUG: dump all top-level keys and grok-related fields
          console.log(`[Grok] 🔍 Mention tweet keys:`, Object.keys(result));
          if (result.grok_analysis) console.log(`[Grok] 🔍 grok_analysis:`, JSON.stringify(result.grok_analysis).substring(0, 500));
          if (result.card) console.log(`[Grok] 🔍 card:`, JSON.stringify(result.card).substring(0, 500));
          if (result.note_tweet) console.log(`[Grok] 🔍 note_tweet:`, JSON.stringify(result.note_tweet).substring(0, 500));
          if (result.quoted_status_result) console.log(`[Grok] 🔍 quoted_status:`, JSON.stringify(result.quoted_status_result).substring(0, 500));
          // Check for any key containing 'grok'
          for (const key of Object.keys(result)) {
            if (key.toLowerCase().includes('grok')) {
              console.log(`[Grok] 🔍 Found grok key "${key}":`, JSON.stringify(result[key]).substring(0, 500));
            }
          }
          break;
        }
      }
    }

    for (const instruction of instructions) {
      const entries = instruction.entries || [];
      for (const entry of entries) {
        if (entry.content?.__typename === 'TimelineTimelineItem') {
          processTweet(entry.content.itemContent?.tweet_results?.result);
        }
        if (entry.content?.__typename === 'TimelineTimelineModule') {
          const items = entry.content.items || [];
          for (const item of items) {
            processTweet(item.item?.itemContent?.tweet_results?.result);
          }
        }
      }
    }

    // Sort mentions by likes (most liked first — most likely to have Grok reply)
    grokMentionTweetIds.sort((a, b) => b.likes - a.likes);

    console.log(`[Grok] ✅ Parsed ${totalParsed} tweets. ${grokMentionTweetIds.length} @grok mentions, ${grokResponses.length} direct Grok responses`);
    if (grokMentionTweetIds.length > 0) {
      console.log(`[Grok] Top mention: tweet ${grokMentionTweetIds[0].id} with ${grokMentionTweetIds[0].likes} likes`);
    }

    return {
      grokMentionTweetIds: grokMentionTweetIds.map(m => m.id),
      grokMentionTexts,
      grokResponses,
      totalParsed,
    };
  }

  // Extract screen_name from a tweet result, trying multiple paths
  function getScreenName(result) {
    // Standard path
    const ur = result?.core?.user_results?.result;
    if (ur?.legacy?.screen_name) return ur.legacy.screen_name;
    // Sometimes nested under user
    if (ur?.screen_name) return ur.screen_name;
    // Check rest_id path
    if (result?.author?.screen_name) return result.author.screen_name;
    // Try legacy directly
    if (result?.legacy?.user_id_str) {
      // Can't resolve, but log it
    }
    return '';
  }

  function getDisplayName(result) {
    const ur = result?.core?.user_results?.result;
    return ur?.legacy?.name || ur?.name || '';
  }

  function getUserId(result) {
    const ur = result?.core?.user_results?.result;
    return ur?.rest_id || ur?.id_str || ur?.legacy?.id_str || '';
  }

  // Deep-search for screen_name in a tweet result object
  function findScreenName(result) {
    // Try all known paths
    const paths = [
      result?.core?.user_results?.result?.legacy?.screen_name,
      result?.core?.user_results?.result?.screen_name,
      result?.core?.user_result?.result?.legacy?.screen_name,
      result?.user_results?.result?.legacy?.screen_name,
      result?.author?.legacy?.screen_name,
      result?.author?.screen_name,
    ];
    for (const v of paths) {
      if (v) return v;
    }
    // Brute force: stringify and regex for screen_name
    try {
      const json = JSON.stringify(result).substring(0, 5000);
      const m = json.match(/"screen_name"\s*:\s*"([^"]+)"/);
      if (m) return m[1];
    } catch (_) {}
    return '';
  }

  // Extract Grok's reply from a second-level TweetDetail response
  function findGrokReply(data) {
    const instructions = data?.data?.threaded_conversation_with_injections_v2?.instructions || [];

    for (const instruction of instructions) {
      const entries = instruction.entries || [];
      for (const entry of entries) {
        const items = [];

        if (entry.content?.__typename === 'TimelineTimelineItem') {
          items.push(entry.content.itemContent?.tweet_results?.result);
        }
        if (entry.content?.__typename === 'TimelineTimelineModule') {
          for (const item of (entry.content.items || [])) {
            items.push(item.item?.itemContent?.tweet_results?.result);
          }
        }

        for (let result of items) {
          if (!result) continue;
          if (result.__typename === 'TweetWithVisibilityResults') result = result.tweet;
          if (!result) continue;

          // Prefer note_tweet for full untruncated text (long tweets)
          const noteText = result?.note_tweet?.note_tweet_results?.result?.text;
          const fullText = noteText || result?.legacy?.full_text || '';
          const screenName = findScreenName(result);

          if (fullText) {
            console.log(`[Grok] 🔎 Reply by @${screenName}: "${fullText.substring(0, 80)}"`);
          }

          if (/^grok$/i.test(screenName) && fullText.length > 10) {
            console.log(`[Grok] 🤖 Found Grok's reply (${fullText.length} chars): "${fullText.substring(0, 200)}"`);
            return fullText;
          }
        }
      }
    }

    console.log(`[Grok] ⚠️ No @grok reply found in this thread`);
    return null;
  }

  // ─── Show Results Popover ────────────────────────────────────────────
  function showResult(tweetArticle, result) {
    const existing = tweetArticle.querySelector(".grok-check-result");
    if (existing) existing.remove();

    const popover = document.createElement("div");
    popover.className = "grok-check-result";

    if (result.error) {
      popover.innerHTML = `
        <div class="grok-result-header">❌ ${escapeHtml(result.error)}</div>
        <button class="grok-result-close">✕</button>
      `;
    } else if (result.grokResponse) {
      popover.innerHTML = `
        <div class="grok-result-header">🤖 Grok says:</div>
        <div class="grok-response-text" style="max-height:400px;overflow-y:auto;white-space:pre-wrap;">${escapeHtml(result.grokResponse)}</div>
        <button class="grok-result-close">✕</button>
      `;
    } else if (result.count > 0) {
      let snippetsHtml = "";
      if (result.snippets?.length > 0) {
        snippetsHtml = result.snippets.slice(0, 3).map(s => 
          `<div class="grok-result-snippet">"${escapeHtml(s.substring(0, 150))}"</div>`
        ).join("");
      }
      popover.innerHTML = `
        <div class="grok-result-header">� ${result.count} @grok mention${result.count > 1 ? "s" : ""} but no Grok response yet</div>
        ${snippetsHtml}
        <button class="grok-result-close">✕</button>
      `;
    } else {
      popover.innerHTML = `
        <div class="grok-result-header">🔍 No @grok mentions found</div>
        <div class="grok-result-body">Nobody asked Grok about this tweet yet.</div>
        <button class="grok-result-close">✕</button>
      `;
    }

    tweetArticle.style.position = "relative";
    tweetArticle.appendChild(popover);
    popover.querySelector(".grok-result-close")?.addEventListener("click", () => popover.remove());
    setTimeout(() => { if (popover.parentElement) popover.remove(); }, 30000);
  }

  // ─── Button Click Handler ────────────────────────────────────────────
  async function handleGrokButtonClick(e, tweetArticle, btnEl) {
    e.preventDefault();
    e.stopPropagation();

    const tweetId = extractTweetId(tweetArticle);
    if (!tweetId) {
      showResult(tweetArticle, { error: "Could not extract tweet ID" });
      return;
    }

    const btnInner = btnEl.querySelector(".grok-check-btn-inner");
    const originalHtml = btnInner.innerHTML;
    btnInner.innerHTML = `${SPINNER_SVG}<span class="grok-check-btn-label">Loading…</span>`;
    btnEl.classList.add("grok-loading");

    console.log(`[Grok] 🔍 Scanning tweet ${tweetId}`);

    try {
      // Step 1: Fetch the original tweet's thread
      const rawData = await fetchTweetThread(tweetId);
      const parsed = parseResponse(rawData);

      let grokResponse = null;

      // Check if Grok responded directly in the thread
      if (parsed.grokResponses.length > 0) {
        grokResponse = parsed.grokResponses[0];
        console.log(`[Grok] Found direct Grok response`);
      }

      // Step 2: If no direct response, check replies to @grok mention tweets
      if (!grokResponse && parsed.grokMentionTweetIds.length > 0) {
        console.log(`[Grok] No direct Grok response. Checking ${parsed.grokMentionTweetIds.length} @grok mention tweets for Grok's replies...`);

        // Check up to 3 mention tweets
        const idsToCheck = parsed.grokMentionTweetIds.slice(0, 3);
        for (const mentionId of idsToCheck) {
          try {
            console.log(`[Grok] Fetching replies to mention tweet ${mentionId}...`);
            const mentionData = await fetchTweetThread(mentionId);
            const reply = findGrokReply(mentionData);
            if (reply) {
              grokResponse = reply;
              break;
            }
          } catch (err) {
            console.warn(`[Grok] Failed to fetch mention tweet ${mentionId}:`, err.message);
          }
        }
      }

      const result = {
        grokResponse,
        count: parsed.grokMentionTexts.length,
        snippets: parsed.grokMentionTexts,
      };

      console.log(`[Grok] Final result: grokResponse=${!!grokResponse}, mentions=${parsed.grokMentionTexts.length}`);
      chrome.storage.local.set({ grokResults: { ...result, timestamp: Date.now(), source: "button" } });
      showResult(tweetArticle, result);
    } catch (err) {
      console.error("[Grok] ❌ Error:", err.message);
      showResult(tweetArticle, { error: err.message });
    } finally {
      btnInner.innerHTML = originalHtml;
      btnEl.classList.remove("grok-loading");
    }
  }

  // ─── Inject Button ───────────────────────────────────────────────────
  function injectButton(tweetArticle) {
    if (tweetArticle.querySelector("." + BUTTON_CLASS)) return;
    const actionBar = findActionBar(tweetArticle);
    if (!actionBar) return;

    const btn = document.createElement("div");
    btn.className = BUTTON_CLASS;
    btn.setAttribute("role", "button");
    btn.setAttribute("tabindex", "0");
    btn.title = "Check for @grok mentions";
    btn.innerHTML = `<div class="grok-check-btn-inner">${ICON_SVG}<span class="grok-check-btn-label">Grok?</span></div>`;

    btn.addEventListener("click", (e) => handleGrokButtonClick(e, tweetArticle, btn));
    btn.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") handleGrokButtonClick(e, tweetArticle, btn);
    });

    actionBar.appendChild(btn);
  }

  // ─── Process Tweets ──────────────────────────────────────────────────
  function processAllTweets() {
    const tweets = document.querySelectorAll(TWEET_SELECTOR);
    tweets.forEach(t => injectButton(t));
  }

  let debounceTimer = null;
  const observer = new MutationObserver(() => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(processAllTweets, 250);
  });

  observer.observe(document.body, { childList: true, subtree: true });
  processAllTweets();

  // ─── Message Listener for Context Menu ────────────────────────────────
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "scanPage") {
      const matches = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
      let node;
      while ((node = walker.nextNode())) {
        const text = node.textContent.trim();
        if (!text) continue;
        if (/@grok\b/i.test(text) || /grok\s+is\s+this\s+real/i.test(text)) {
          matches.push(text.substring(0, 200));
        }
      }
      const result = { count: matches.length, snippets: matches.slice(0, 10), timestamp: Date.now(), source: "contextMenu", url: window.location.href };
      chrome.storage.local.set({ grokResults: result });
      sendResponse(result);
      return true;
    }
  });
})();
