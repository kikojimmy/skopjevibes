const VENUES = [
  'elpresidenteskopje',
  'creshabar',
  'pogon.bar',
  'tribeca.park',
  'kafana_kafana_ilinden',
  'sojubar.mk',
  'casabar_skopje',
  'crashbar.mk',
  'beertijapub',
  'rias.restaurant.bar',
  'kaldrma_',
  'kinokarpos.bar',
  'saloonskopje',
  'trn_vo_oko',
  'lokal.45',
  'netaville.mk',
];

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = '8529683964';
const FIREBASE_API_KEY = 'AIzaSyDOxqfSkmXbRYbMW0ph2aOM-35BDJOAk5E';
const FIRESTORE_BASE = 'https://firestore.googleapis.com/v1/projects/skopjevibes-df97b/databases/(default)/documents';

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function getLastSeen(username) {
  try {
    const res = await fetch(
      `${FIRESTORE_BASE}/venue_tracking/${username}?key=${FIREBASE_API_KEY}`
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data.fields?.lastPostId?.stringValue || null;
  } catch {
    return null;
  }
}

async function saveLastSeen(username, postId) {
  const body = {
    fields: {
      lastPostId: { stringValue: postId },
      lastChecked: { stringValue: new Date().toISOString() },
    },
  };
  await fetch(
    `${FIRESTORE_BASE}/venue_tracking/${username}?key=${FIREBASE_API_KEY}&updateMask.fieldPaths=lastPostId&updateMask.fieldPaths=lastChecked`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );
}

async function sendTelegram(username) {
  if (!TELEGRAM_BOT_TOKEN) {
    console.log(`[TELEGRAM] No token configured, skipping for ${username}`);
    return;
  }
  await fetch(
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text: `🔔 @${username} постирал нов пост!\nПровери: https://instagram.com/${username}`,
      }),
    }
  );
}

async function getLatestPostId(username) {
  // Primary: internal API endpoint (no login required, works on many accounts)
  try {
    const apiRes = await fetch(
      `https://www.instagram.com/api/v1/users/web_profile_info/?username=${username}`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'X-IG-App-ID': '936619743392459',
          'Accept': '*/*',
          'Referer': 'https://www.instagram.com/',
        },
      }
    );
    if (apiRes.ok) {
      const json = await apiRes.json();
      const edges = json?.data?.user?.edge_owner_to_timeline_media?.edges;
      if (edges && edges.length > 0) {
        const node = edges[0].node;
        return node.shortcode || String(node.taken_at_timestamp);
      }
    }
  } catch (_) {}

  // Fallback: scrape public profile HTML
  const htmlRes = await fetch(`https://www.instagram.com/${username}/`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Cache-Control': 'no-cache',
    },
    redirect: 'follow',
  });

  if (!htmlRes.ok) throw new Error(`HTTP ${htmlRes.status}`);

  const html = await htmlRes.text();

  // Pattern 1: shortcode in JSON blobs
  const shortcodeMatch = html.match(/"shortcode"\s*:\s*"([A-Za-z0-9_-]{10,})"/);
  if (shortcodeMatch) return shortcodeMatch[1];

  // Pattern 2: /p/SHORTCODE/ links
  const postLinkMatch = html.match(/\/p\/([A-Za-z0-9_-]{10,})\//);
  if (postLinkMatch) return postLinkMatch[1];

  // Pattern 3: timestamp value
  const timestampMatch = html.match(/"timestamp"\s*:\s*(\d{10,})/);
  if (timestampMatch) return timestampMatch[1];

  // Pattern 4: og:image URL as last-resort identifier
  const ogImageMatch = html.match(/property="og:image"\s+content="([^"]+)"/);
  if (ogImageMatch) return ogImageMatch[1].slice(0, 120);

  throw new Error('Could not extract post identifier');
}

module.exports = async (req, res) => {
  console.log(`[check-venues] Starting — ${VENUES.length} venues, ${new Date().toISOString()}`);

  const results = [];

  for (const username of VENUES) {
    try {
      console.log(`[${username}] Checking...`);
      const postId = await getLatestPostId(username);
      const lastSeen = await getLastSeen(username);

      if (!lastSeen) {
        await saveLastSeen(username, postId);
        console.log(`[${username}] ✅ Initialized: ${postId.slice(0, 24)}`);
        results.push({ username, status: 'initialized' });
      } else if (postId !== lastSeen) {
        await sendTelegram(username);
        await saveLastSeen(username, postId);
        console.log(`[${username}] 🔔 NEW POST: ${postId.slice(0, 24)}`);
        results.push({ username, status: 'new_post' });
      } else {
        console.log(`[${username}] ✓ No change`);
        results.push({ username, status: 'no_change' });
      }
    } catch (err) {
      console.error(`[${username}] ❌ ${err.message}`);
      results.push({ username, status: 'error', error: err.message });
    }

    await delay(1000);
  }

  const summary = {
    checked: results.length,
    newPosts: results.filter(r => r.status === 'new_post').length,
    initialized: results.filter(r => r.status === 'initialized').length,
    errors: results.filter(r => r.status === 'error').length,
    results,
  };

  console.log(`[check-venues] Done — ${summary.newPosts} new, ${summary.errors} errors`);
  res.status(200).json(summary);
};
