/**
 * Grok Is This Real? — Injected into MAIN world (runs at document_start)
 *
 * 1. Monkey-patches fetch() AND XMLHttpRequest to capture auth + TweetDetail hash
 * 2. Scans X's JS bundles after DOM ready to extract TweetDetail queryId
 * 3. Replays TweetDetail calls with dynamically captured params
 */

(function () {
  "use strict";

  // ─── State ─────────────────────────────────────────────────────────────
  const _fetch = window.fetch.bind(window);
  const _xhrOpen = XMLHttpRequest.prototype.open;
  const _xhrSetHeader = XMLHttpRequest.prototype.setRequestHeader;

  let captured = {
    hash: null,
    features: null,
    fieldToggles: null,
    authorization: null,
    csrfToken: null,
  };

  let hashResolve;
  const hashReady = new Promise((r) => { hashResolve = r; });

  function getCookie(name) {
    const m = document.cookie.match(new RegExp('(?:^| )' + name + '=([^;]+)'));
    return m ? m[1] : null;
  }

  function extractUrl(resource) {
    if (typeof resource === 'string') return resource;
    if (resource instanceof Request) return resource.url;
    if (resource instanceof URL) return resource.href;
    if (resource && typeof resource.toString === 'function') return resource.toString();
    return '';
  }

  function extractHeaders(resource, config) {
    // Headers can be on the config object or on the Request object
    let headers = config?.headers;
    if (!headers && resource instanceof Request) {
      headers = resource.headers;
    }
    if (!headers) return {};
    if (headers instanceof Headers) return Object.fromEntries(headers.entries());
    return headers;
  }

  function processGraphQLUrl(url, headers) {
    if (!url || !url.includes('/i/api/graphql/')) return;

    // Capture auth from ANY GraphQL request
    if (headers) {
      const auth = headers['authorization'] || headers['Authorization'];
      if (auth && !captured.authorization) {
        captured.authorization = auth;
        captured.csrfToken = headers['x-csrf-token'] || headers['X-Csrf-Token'] || getCookie('ct0');
        console.log(`[Grok MAIN] ✅ Captured auth from GraphQL request`);
      }
    }

    // Capture TweetDetail hash + features + fieldToggles
    if (url.includes('/TweetDetail')) {
      const hashMatch = url.match(/\/graphql\/([^/?]+)\/TweetDetail/);
      if (hashMatch && !captured.hash) {
        captured.hash = hashMatch[1];
        console.log(`[Grok MAIN] ✅ Captured TweetDetail hash from live request: ${captured.hash}`);
        hashResolve();
      }
      try {
        const u = new URL(url);
        const f = u.searchParams.get('features');
        if (f) captured.features = f;
        const ft = u.searchParams.get('fieldToggles');
        if (ft) captured.fieldToggles = ft;
      } catch (_) {}
    }
  }

  // ─── 1. Intercept fetch() ──────────────────────────────────────────────
  window.fetch = function (resource, config) {
    try {
      const url = extractUrl(resource);
      const headers = extractHeaders(resource, config);
      processGraphQLUrl(url, headers);
    } catch (_) {}
    return _fetch.apply(this, arguments);
  };

  // ─── 2. Intercept XMLHttpRequest ──────────────────────────────────────
  XMLHttpRequest.prototype.open = function (method, url) {
    this._grokUrl = typeof url === 'string' ? url : (url?.toString() || '');
    this._grokHeaders = {};
    return _xhrOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    if (this._grokHeaders) this._grokHeaders[name] = value;
    return _xhrSetHeader.apply(this, arguments);
  };

  const _xhrSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function () {
    try {
      processGraphQLUrl(this._grokUrl, this._grokHeaders);
    } catch (_) {}
    return _xhrSend.apply(this, arguments);
  };

  // ─── 3. Scan JS bundles for TweetDetail queryId ────────────────────────
  const FALLBACK_FEATURES = '{"rweb_video_screen_enabled":false,"profile_label_improvements_pcf_label_in_post_enabled":true,"responsive_web_profile_redirect_enabled":false,"rweb_tipjar_consumption_enabled":false,"verified_phone_label_enabled":false,"creator_subscriptions_tweet_preview_api_enabled":true,"responsive_web_graphql_timeline_navigation_enabled":true,"responsive_web_graphql_skip_user_profile_image_extensions_enabled":false,"premium_content_api_read_enabled":false,"communities_web_enable_tweet_community_results_fetch":true,"c9s_tweet_anatomy_moderator_badge_enabled":true,"responsive_web_grok_analyze_button_fetch_trends_enabled":false,"responsive_web_grok_analyze_post_followups_enabled":true,"responsive_web_jetfuel_frame":true,"responsive_web_grok_share_attachment_enabled":true,"responsive_web_grok_annotations_enabled":true,"articles_preview_enabled":true,"responsive_web_edit_tweet_api_enabled":true,"graphql_is_translatable_rweb_tweet_is_translatable_enabled":true,"view_counts_everywhere_api_enabled":true,"longform_notetweets_consumption_enabled":true,"responsive_web_twitter_article_tweet_consumption_enabled":true,"tweet_awards_web_tipping_enabled":false,"content_disclosure_indicator_enabled":true,"content_disclosure_ai_generated_indicator_enabled":true,"responsive_web_grok_show_grok_translated_post":true,"responsive_web_grok_analysis_button_from_backend":true,"post_ctas_fetch_enabled":true,"freedom_of_speech_not_reach_fetch_enabled":true,"standardized_nudges_misinfo":true,"tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled":true,"longform_notetweets_rich_text_read_enabled":true,"longform_notetweets_inline_media_enabled":false,"responsive_web_grok_image_annotation_enabled":true,"responsive_web_grok_imagine_annotation_enabled":true,"responsive_web_grok_community_note_auto_translation_is_enabled":false,"responsive_web_enhance_cards_enabled":false}';
  const FALLBACK_FIELD_TOGGLES = '{"withArticleRichContentState":true,"withArticlePlainText":false,"withArticleSummaryText":false,"withArticleVoiceOver":false,"withGrokAnalyze":false,"withDisallowedReplyControls":false}';

  async function scanBundlesForHash() {
    if (captured.hash) return;

    const scripts = document.querySelectorAll('script[src]');
    const urls = [];
    for (const s of scripts) {
      const src = s.getAttribute('src');
      if (src && src.includes('.js')) {
        urls.push(src.startsWith('http') ? src : new URL(src, location.origin).href);
      }
    }

    console.log(`[Grok MAIN] Scanning ${urls.length} JS bundles for TweetDetail hash...`);
    if (urls.length === 0) {
      console.warn(`[Grok MAIN] No JS bundles found in DOM`);
      return;
    }

    // Log first few URLs for debugging
    console.log(`[Grok MAIN] Sample bundle URLs:`, urls.slice(0, 3));

    const BATCH = 4;
    for (let i = 0; i < urls.length; i += BATCH) {
      if (captured.hash) return;

      const batch = urls.slice(i, i + BATCH);
      const results = await Promise.allSettled(
        batch.map(u => _fetch(u).then(r => r.text()))
      );

      for (const result of results) {
        if (result.status !== 'fulfilled') continue;
        const text = result.value;

        // Search for TweetDetail near a queryId
        const idx = text.indexOf('"TweetDetail"');
        if (idx === -1) continue;

        console.log(`[Grok MAIN] Found "TweetDetail" in bundle, extracting hash...`);

        // Look backwards from "TweetDetail" for queryId
        const before = text.substring(Math.max(0, idx - 200), idx);
        // Pattern: queryId:"HASH" — the hash is the last quoted string before operationName
        const hashMatch = before.match(/queryId\s*:\s*"([^"]+)"\s*$/m) ||
                          before.match(/"([A-Za-z0-9_-]{10,})"\s*,\s*operationName\s*$/m) ||
                          before.match(/queryId\s*:\s*"([^"]+)"/g);

        if (hashMatch) {
          // Get the last match if multiple
          let hash;
          if (Array.isArray(hashMatch) && hashMatch.length > 0) {
            const last = hashMatch[hashMatch.length - 1];
            const hm = last.match(/"([^"]+)"/);
            hash = hm ? hm[1] : null;
          } else {
            hash = hashMatch[1];
          }

          if (hash && hash.length > 5) {
            captured.hash = hash;
            console.log(`[Grok MAIN] ✅ Found TweetDetail hash from bundle: ${captured.hash}`);
            hashResolve();
            return;
          }
        }

        // Fallback: look for any queryId near TweetDetail in a wider window
        const window_ = text.substring(Math.max(0, idx - 500), Math.min(text.length, idx + 100));
        const fallback = window_.match(/queryId\s*:\s*"([^"]+)"/);
        if (fallback && fallback[1].length > 5) {
          captured.hash = fallback[1];
          console.log(`[Grok MAIN] ✅ Found TweetDetail hash (fallback) from bundle: ${captured.hash}`);
          hashResolve();
          return;
        }
      }
    }

    console.warn(`[Grok MAIN] ⚠️ Could not find TweetDetail hash in ${urls.length} bundles`);
  }

  // ─── 4. Make our own TweetDetail call ──────────────────────────────────
  async function fetchTweetThread(tweetId) {
    if (!captured.hash) {
      const timeout = new Promise((_, rej) =>
        setTimeout(() => rej(new Error('Could not find TweetDetail endpoint. Try clicking on a tweet first, then try again.')), 15000)
      );
      await Promise.race([hashReady, timeout]);
    }

    const ct0 = captured.csrfToken || getCookie('ct0');
    if (!ct0) throw new Error('Not logged in (no ct0 cookie)');

    const auth = captured.authorization ||
      'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';

    console.log(`[Grok MAIN] Fetching tweet ${tweetId} with hash ${captured.hash}`);

    const variables = {
      focalTweetId: tweetId,
      with_rux_injections: false,
      rankingMode: "Relevance",
      includePromotedContent: true,
      withCommunity: true,
      withQuickPromoteEligibilityTweetFields: true,
      withBirdwatchNotes: true,
      withVoice: true
    };

    const endpoint = `https://x.com/i/api/graphql/${captured.hash}/TweetDetail`;
    let url = `${endpoint}?variables=${encodeURIComponent(JSON.stringify(variables))}`;

    const features = captured.features || FALLBACK_FEATURES;
    const fieldToggles = captured.fieldToggles || FALLBACK_FIELD_TOGGLES;
    url += `&features=${encodeURIComponent(features)}`;
    url += `&fieldToggles=${encodeURIComponent(fieldToggles)}`;

    const resp = await _fetch(url, {
      method: 'GET',
      headers: {
        'authorization': auth,
        'x-csrf-token': ct0,
        'content-type': 'application/json',
        'accept': '*/*',
        'x-twitter-active-user': 'yes',
        'x-twitter-client-language': 'en',
      },
      credentials: 'include'
    });

    console.log(`[Grok MAIN] API response: ${resp.status} ${resp.statusText}`);

    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      console.error(`[Grok MAIN] API error: ${body.substring(0, 300)}`);
      throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
    }

    return await resp.json();
  }

  // ─── 5. Listen for requests from content script ────────────────────────
  window.addEventListener('message', async (event) => {
    if (event.source !== window) return;
    if (event.data?.type !== 'GROK_FETCH_REQUEST') return;

    const { tweetId, requestId } = event.data;
    console.log(`[Grok MAIN] Request for tweet ${tweetId} (req ${requestId}) — hash: ${captured.hash || 'pending...'}, auth: ${!!captured.authorization}`);

    try {
      const data = await fetchTweetThread(tweetId);
      window.postMessage({ type: 'GROK_FETCH_RESPONSE', requestId, success: true, data }, '*');
    } catch (err) {
      console.error(`[Grok MAIN] Error:`, err.message);
      window.postMessage({ type: 'GROK_FETCH_RESPONSE', requestId, success: false, error: err.message }, '*');
    }
  });

  // ─── Boot ──────────────────────────────────────────────────────────────
  console.log('[Grok MAIN] Intercepts active (fetch + XHR). Waiting for DOM to scan bundles...');

  function startBundleScan() {
    if (captured.hash) return;
    // Small delay to ensure all scripts are in the DOM
    setTimeout(() => scanBundlesForHash(), 500);
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    startBundleScan();
  } else {
    window.addEventListener('load', startBundleScan);
  }
})();
