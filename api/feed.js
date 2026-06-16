// api/feed.js
// Vercel serverless function — runs on Vercel's servers, not the browser
// This fetches real RSS feeds from South African news sources
// and filters for voter/election related content

const KEYWORDS = [
  "voter registration", "voters roll", "register to vote",
  "IEC", "electoral commission", "polling station",
  "municipal election", "ward", "ballot", "election",
  "registration drive", "voter", "voting", "registration deadline",
  "kieserregistrasie", "ukuvota", "ukubhalisa"
];

// SA news RSS feeds — all free, no API key needed
const RSS_FEEDS = [
  { url: "https://feeds.news24.com/articles/news24/SouthAfrica/rss", source: "News24" },
  { url: "https://www.dailymaverick.co.za/feed/", source: "Daily Maverick" },
  { url: "https://www.groundup.org.za/feed/", source: "GroundUp" },
  { url: "https://www.sabc.co.za/sabc/feed/", source: "SABC News" },
  { url: "https://www.iol.co.za/rss/allstories.xml", source: "IOL" },
  { url: "https://ewn.co.za/RSS%20Feeds/Latest%20News", source: "EWN" },
];

// Province detection from article text
const PROVINCE_KEYWORDS = {
  "Gauteng": ["gauteng", "johannesburg", "joburg", "tshwane", "pretoria", "ekurhuleni", "soweto", "sandton"],
  "Western Cape": ["western cape", "cape town", "stellenbosch", "george", "drakenstein", "knysna"],
  "KwaZulu-Natal": ["kwazulu-natal", "kzn", "durban", "ethekwini", "pietermaritzburg", "newcastle"],
  "Eastern Cape": ["eastern cape", "buffalo city", "east london", "port elizabeth", "gqeberha", "mthatha"],
  "Limpopo": ["limpopo", "polokwane", "mokopane", "thohoyandou", "tzaneen"],
  "Mpumalanga": ["mpumalanga", "mbombela", "nelspruit", "witbank", "emalahleni"],
  "North West": ["north west", "rustenburg", "mahikeng", "potchefstroom", "klerksdorp"],
  "Free State": ["free state", "mangaung", "bloemfontein", "welkom", "bethlehem"],
  "Northern Cape": ["northern cape", "sol plaatje", "kimberley", "upington", "springbok"],
};

function detectProvince(text) {
  const lower = text.toLowerCase();
  for (const [province, keywords] of Object.entries(PROVINCE_KEYWORDS)) {
    if (keywords.some(k => lower.includes(k))) return province;
  }
  return "National";
}

function detectSentiment(text) {
  const lower = text.toLowerCase();
  if (lower.includes("concern") || lower.includes("problem") || lower.includes("fail") ||
      lower.includes("barrier") || lower.includes("unable") || lower.includes("alarm") ||
      lower.includes("load shed") || lower.includes("closed") || lower.includes("queue")) return "negative";
  if (lower.includes("success") || lower.includes("record") || lower.includes("urge") ||
      lower.includes("campaign") || lower.includes("drive") || lower.includes("momentum")) return "positive";
  if (lower.includes("deadline") || lower.includes("urgent") || lower.includes("warning") ||
      lower.includes("approaching") || lower.includes("last chance")) return "urgent";
  if (lower.includes("how") || lower.includes("confused") || lower.includes("unclear") ||
      lower.includes("question") || lower.includes("what is")) return "query";
  return "neutral";
}

function detectCategory(text) {
  const lower = text.toLowerCase();
  if (lower.includes("iec") || lower.includes("official") || lower.includes("commission")) return "official";
  if (lower.includes("deadline") || lower.includes("last day") || lower.includes("closes")) return "deadline";
  if (lower.includes("barrier") || lower.includes("transport") || lower.includes("access") ||
      lower.includes("load shed")) return "barrier";
  if (lower.includes("concern") || lower.includes("problem") || lower.includes("issue")) return "concern";
  if (lower.includes("how") || lower.includes("where") || lower.includes("when") ||
      lower.includes("question")) return "query";
  return "registration";
}

function isRelevant(title, description) {
  const text = `${title} ${description}`.toLowerCase();
  return KEYWORDS.some(k => text.includes(k.toLowerCase()));
}

function timeAgo(dateStr) {
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);
    if (diffMins < 60) return `${diffMins} min ago`;
    if (diffHours < 24) return `${diffHours} hr ago`;
    return `${diffDays} day${diffDays > 1 ? "s" : ""} ago`;
  } catch {
    return "recently";
  }
}

async function parseFeed(feedUrl, sourceName) {
  try {
    const res = await fetch(feedUrl, {
      headers: { "User-Agent": "VoterWatchSA/2.0 (election monitoring)" },
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) return [];
    const xml = await res.text();

    // Parse RSS items using regex (no XML parser needed)
    const items = [];
    const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/gi;
    let match;
    let id = 0;

    while ((match = itemRegex.exec(xml)) !== null) {
      const item = match[1];
      const title = (item.match(/<title[^>]*><!\[CDATA\[(.*?)\]\]><\/title>/i) ||
                     item.match(/<title[^>]*>(.*?)<\/title>/i) || [])[1] || "";
      const description = (item.match(/<description[^>]*><!\[CDATA\[(.*?)\]\]><\/description>/i) ||
                           item.match(/<description[^>]*>(.*?)<\/description>/i) || [])[1] || "";
      const link = (item.match(/<link[^>]*>(.*?)<\/link>/i) || [])[1] || "";
      const pubDate = (item.match(/<pubDate[^>]*>(.*?)<\/pubDate>/i) || [])[1] || "";

      const cleanTitle = title.replace(/<[^>]+>/g, "").trim();
      const cleanDesc = description.replace(/<[^>]+>/g, "").trim();

      if (cleanTitle && isRelevant(cleanTitle, cleanDesc)) {
        const province = detectProvince(`${cleanTitle} ${cleanDesc}`);
        items.push({
          id: `${sourceName}-${id++}`,
          source: sourceName,
          title: cleanTitle,
          description: cleanDesc.substring(0, 200),
          link: link.trim(),
          province,
          municipality: province,
          time: timeAgo(pubDate),
          pubDate,
          sentiment: detectSentiment(`${cleanTitle} ${cleanDesc}`),
          category: detectCategory(`${cleanTitle} ${cleanDesc}`),
          live: true
        });
      }
      if (items.length >= 5) break; // Max 5 per source
    }
    return items;
  } catch (err) {
    console.error(`Feed error for ${sourceName}:`, err.message);
    return [];
  }
}

// Fallback items shown when feeds return nothing relevant
const FALLBACK_ITEMS = [
  { id: "f1", source: "News24", province: "Gauteng", municipality: "City of Tshwane", time: "2 hr ago", title: "IEC opens new registration points across Tshwane ahead of municipal elections", sentiment: "neutral", category: "official", live: false },
  { id: "f2", source: "Daily Maverick", province: "Western Cape", municipality: "City of Cape Town", time: "3 hr ago", title: "Cape Town voter registration drive sees record turnout in Mitchell's Plain", sentiment: "positive", category: "registration", live: false },
  { id: "f3", source: "GroundUp", province: "Eastern Cape", municipality: "Buffalo City", time: "4 hr ago", title: "Hundreds of Eastern Cape residents still unregistered — civic groups raise alarm", sentiment: "negative", category: "concern", live: false },
  { id: "f4", source: "SABC News", province: "Limpopo", municipality: "Polokwane", time: "5 hr ago", title: "Rural Limpopo communities face transport barriers reaching registration centres", sentiment: "negative", category: "barrier", live: false },
  { id: "f5", source: "IOL", province: "Gauteng", municipality: "City of Johannesburg", time: "6 hr ago", title: "IEC warns: voter registration deadline approaching — check your status now", sentiment: "urgent", category: "deadline", live: false },
  { id: "f6", source: "EWN", province: "KwaZulu-Natal", municipality: "eThekwini", time: "7 hr ago", title: "Youth registration drive gains momentum across Durban townships", sentiment: "positive", category: "registration", live: false },
];

export default async function handler(req, res) {
  // Fetch all feeds in parallel
  const results = await Promise.allSettled(
    RSS_FEEDS.map(f => parseFeed(f.url, f.source))
  );

  let items = results
    .filter(r => r.status === "fulfilled")
    .flatMap(r => r.value);

  // Sort by publication date, newest first
  items.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

  // If no live items found (quiet news day), use fallback
  if (items.length === 0) {
    items = FALLBACK_ITEMS;
  }

  // Add index for stable IDs
  items = items.map((item, i) => ({ ...item, id: item.id || i }));

  res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate"); // Cache 5 mins
  res.status(200).json({
    items,
    fetchedAt: new Date().toISOString(),
    liveCount: items.filter(i => i.live).length,
    totalCount: items.length
  });
}
