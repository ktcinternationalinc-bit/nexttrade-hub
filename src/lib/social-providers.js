// ============================================================
// src/lib/social-providers.js
// One place that decides HOW a post goes out per platform.
//
// Today every platform is in MANUAL mode: publish() returns
// { manual: true } so the dispatcher pings the user to post by hand.
//
// After a platform's API access is approved (Meta app review for
// Facebook/Instagram, LinkedIn partner approval), flip that platform's
// `live` flag to true and fill in its publishLive() body. Nothing else
// in the system has to change — the dispatcher already routes through here.
//
// IMPORTANT (per build rules): API-route-adjacent code uses var +
// string concatenation, no template literals, no let/const.
// ============================================================

// Per-platform capability flags. 'live:false' => manual (ping the user).
var PROVIDERS = {
  linkedin:  { label: 'LinkedIn',  live: false, envKeys: ['LINKEDIN_ACCESS_TOKEN', 'LINKEDIN_ORG_URN'] },
  facebook:  { label: 'Facebook',  live: false, envKeys: ['META_PAGE_TOKEN', 'META_PAGE_ID'] },
  instagram: { label: 'Instagram', live: false, envKeys: ['META_PAGE_TOKEN', 'META_IG_USER_ID'] }
};

// Is this platform configured for true auto-posting yet?
function isLive(platform) {
  var p = PROVIDERS[platform];
  if (!p || !p.live) return false;
  // Even when flagged live, require the env keys to actually exist.
  for (var i = 0; i < p.envKeys.length; i++) {
    if (!process.env[p.envKeys[i]]) return false;
  }
  return true;
}

function labelFor(platform) {
  var p = PROVIDERS[platform];
  return p ? p.label : (platform || 'Social');
}

// Build the plain-text body the user copies when posting manually.
function composeText(caption, hashtags) {
  var tags = '';
  if (Array.isArray(hashtags) && hashtags.length > 0) {
    tags = '\n\n' + hashtags.map(function (h) {
      var s = String(h || '').trim();
      if (!s) return '';
      return s.charAt(0) === '#' ? s : ('#' + s);
    }).filter(Boolean).join(' ');
  }
  return String(caption || '') + tags;
}

// MAIN ENTRY. The dispatcher calls this for each due post.
// Returns one of:
//   { mode: 'manual', text: '...' }                  -> ping the user to publish
//   { mode: 'auto', ok: true,  result: {...} }        -> posted automatically
//   { mode: 'auto', ok: false, error: '...' }         -> auto attempt failed
async function publish(platform, caption, hashtags) {
  var text = composeText(caption, hashtags);

  if (!isLive(platform)) {
    // Manual mode (today): hand the ready-to-paste text back to the caller.
    return { mode: 'manual', text: text };
  }

  // Auto mode (after approval). Each platform's real call goes here.
  try {
    var result = await publishLive(platform, text);
    return { mode: 'auto', ok: true, result: result };
  } catch (e) {
    return { mode: 'auto', ok: false, error: (e && e.message) || 'auto-post failed' };
  }
}

// Placeholder for the real platform API calls. Filled in per-platform
// once that platform is approved. Until then isLive() is false so this
// never runs. Kept here so the wiring is already in place.
async function publishLive(platform, text) {
  // EXAMPLE shape for when LinkedIn is approved (do NOT enable until then):
  //
  // if (platform === 'linkedin') {
  //   var resp = await fetch('https://api.linkedin.com/v2/ugcPosts', {
  //     method: 'POST',
  //     headers: {
  //       'Authorization': 'Bearer ' + process.env.LINKEDIN_ACCESS_TOKEN,
  //       'Content-Type': 'application/json',
  //       'X-Restli-Protocol-Version': '2.0.0'
  //     },
  //     body: JSON.stringify({
  //       author: process.env.LINKEDIN_ORG_URN,
  //       lifecycleState: 'PUBLISHED',
  //       specificContent: { 'com.linkedin.ugc.ShareContent': {
  //         shareCommentary: { text: text },
  //         shareMediaCategory: 'NONE'
  //       } },
  //       visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' }
  //     })
  //   });
  //   if (!resp.ok) throw new Error('LinkedIn API ' + resp.status);
  //   return await resp.json();
  // }
  throw new Error('Live posting for ' + platform + ' is not enabled yet');
}

export { PROVIDERS, isLive, labelFor, composeText, publish };
