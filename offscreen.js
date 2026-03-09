/**
 * Grok Is This Real? — Offscreen Document
 * Runs in a normal browsing context so fetch() with credentials:'include' works.
 * The service worker can't send cookies, but this document can.
 */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'offscreen-fetch-tweet') {
    const { tweetId, ct0 } = message;
    console.log(`[Grok Offscreen] Fetching tweet ${tweetId}...`);

    fetchTweetDetail(tweetId, ct0)
      .then((data) => {
        console.log(`[Grok Offscreen] Got response, sending back to background`);
        sendResponse({ success: true, data: data });
      })
      .catch((err) => {
        console.error(`[Grok Offscreen] Error:`, err.message);
        sendResponse({ success: false, error: err.message });
      });

    return true; // async
  }
});

async function fetchTweetDetail(tweetId, ct0) {
  const BEARER = 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';

  const endpoint = 'https://x.com/i/api/graphql/8h-5EdMVwO3L_3h3DpB7_Q/TweetDetail';

  const variables = {
    focalTweetId: tweetId,
    with_rux_injections: false,
    rankingMode: "Relevance",
    includePromotedContent: true,
    withCommunity: true,
    withQuickPromoteEligibilityQueryParams: true,
    withBirdwatchNotes: true,
    withVoice: true,
    withV2Timeline: true
  };

  const features = {
    rweb_tipjar_consumption_enabled: true,
    responsive_web_graphql_exclude_directive_enabled: true,
    verified_phone_label_enabled: true,
    creator_subscriptions_tweet_preview_api_enabled: true,
    responsive_web_graphql_timeline_navigation_enabled: true,
    responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
    communities_web_enable_tweet_community_results_fetch: true,
    c9s_tweet_anatomy_moderator_badge_enabled: true,
    tweetypie_unmention_optimization_enabled: true,
    responsive_web_edit_tweet_api_enabled: true,
    graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
    view_counts_everywhere_api_enabled: true,
    longform_notetweets_consumption_enabled: true,
    responsive_web_twitter_article_tweet_consumption_enabled: false,
    tweet_awards_web_tipping_enabled: false,
    freedom_of_speech_not_reach_fetch_enabled: true,
    standardized_nudges_misinfo: true,
    tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
    longform_notetweets_rich_text_read_enabled: true,
    longform_notetweets_inline_media_enabled: true,
    responsive_web_media_download_video_enabled: false,
    responsive_web_enhance_cards_enabled: false
  };

  const url = `${endpoint}?variables=${encodeURIComponent(JSON.stringify(variables))}&features=${encodeURIComponent(JSON.stringify(features))}`;

  console.log(`[Grok Offscreen] Calling API with credentials:include...`);

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'authorization': BEARER,
      'x-csrf-token': ct0,
      'content-type': 'application/json',
      'accept': '*/*',
      'x-twitter-active-user': 'yes',
      'x-twitter-client-language': 'en',
    },
    credentials: 'include'
  });

  console.log(`[Grok Offscreen] API status: ${response.status}`);

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    console.error(`[Grok Offscreen] Error body: ${body.substring(0, 300)}`);
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  return await response.json();
}
