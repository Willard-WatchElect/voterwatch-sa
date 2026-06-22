// api/feed.js — VoterWatch SA v5
// Uses rss2json.com as a reliable middleman to fetch SA news RSS feeds.
// This solves the problem of Vercel's overseas servers being blocked by SA news sites.

const TOPICS = {
  voter: {
    label: "Voter Registration",
    keywords: ["voter registration","voters roll","register to vote","IEC","electoral commission",
      "polling station","municipal election","ward","ballot","election","registration drive",
      "voter","voting","registration deadline","kieserregistrasie","ukuvota","ukubhalisa"]
  },
  youth: {
    label: "National Youth Day & IEC",
    keywords: ["national youth day","youth day","june 16","soweto uprising","youth month","IEC",
      "electoral commission","young voters","youth vote","youth registration","student voters",
      "youth parliament","NYDA","young people","16 june","youth employment"]
  }
};

// Updated, verified SA news RSS feed URLs routed through rss2json
const RSS_FEEDS = [
  { url: "https://www.news24.com/rss", source: "News24" },
  { url: "https://dailymaverick.co.za/dmrss", source: "Daily Maverick" },
  { url: "https://www.groundup.org.za/feed/", source: "GroundUp" },
  { url: "https://ewn.co.za/RSS%20Feeds/Latest%20News", source: "EWN" },
  { url: "https://www.iol.co.za/rss/allstories.xml", source: "IOL" },
  { url: "https://mg.co.za/feed", source: "Mail & Guardian" },
];

// rss2json free API — converts RSS to clean JSON, bypasses SA site blocking
const RSS2JSON = "https://api.rss2json.com/v1/api.json?rss_url=";

const PROVINCE_KEYWORDS = {
  "Gauteng":["gauteng","johannesburg","joburg","tshwane","pretoria","ekurhuleni","soweto","sandton"],
  "Western Cape":["western cape","cape town","stellenbosch","george","drakenstein","knysna","paarl"],
  "KwaZulu-Natal":["kwazulu-natal","kzn","durban","ethekwini","pietermaritzburg","newcastle","richards bay"],
  "Eastern Cape":["eastern cape","buffalo city","east london","port elizabeth","gqeberha","mthatha","queenstown"],
  "Limpopo":["limpopo","polokwane","mokopane","thohoyandou","tzaneen","bela-bela"],
  "Mpumalanga":["mpumalanga","mbombela","nelspruit","witbank","emalahleni","secunda"],
  "North West":["north west","rustenburg","mahikeng","potchefstroom","klerksdorp","brits"],
  "Free State":["free state","mangaung","bloemfontein","welkom","bethlehem","kroonstad"],
  "Northern Cape":["northern cape","sol plaatje","kimberley","upington","springbok","kuruman"],
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
  if (["concern","problem","fail","barrier","alarm","closed","queue","unable","reject","deny","block"].some(w => lower.includes(w))) return "negative";
  if (["success","record","campaign","drive","momentum","launch","celebrat","increase","rise","grow","urge","encourage"].some(w => lower.includes(w))) return "positive";
  if (["deadline","urgent","warning","approaching","last chance","final day"].some(w => lower.includes(w))) return "urgent";
  if (["how","where","when","what is","confused","question","unclear"].some(w => lower.includes(w))) return "query";
  return "neutral";
}

function detectCategory(text) {
  const lower = text.toLowerCase();
  if (["iec","official","commission","minister","government","announced"].some(w => lower.includes(w))) return "official";
  if (["deadline","last day","closes","closing","final"].some(w => lower.includes(w))) return "deadline";
  if (["barrier","transport","load shed","access","unable to reach"].some(w => lower.includes(w))) return "barrier";
  if (["concern","problem","issue","complaint","criticism"].some(w => lower.includes(w))) return "concern";
  return "registration";
}

function isRelevant(title, desc, keywords) {
  const text = `${title} ${desc}`.toLowerCase();
  return keywords.some(k => text.includes(k.toLowerCase()));
}

function timeAgo(dateStr) {
  try {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    const hrs = Math.floor(mins / 60);
    const days = Math.floor(hrs / 24);
    if (mins < 60) return `${mins} min ago`;
    if (hrs < 24) return `${hrs} hr ago`;
    return `${days} day${days > 1 ? "s" : ""} ago`;
  } catch { return "recently"; }
}

async function fetchViaRss2Json(feedUrl, sourceName, keywords) {
  try {
    const apiUrl = `${RSS2JSON}${encodeURIComponent(feedUrl)}&count=20`;
    const res = await fetch(apiUrl, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return [];
    const data = await res.json();
    if (data.status !== "ok" || !data.items) return [];

    const items = [];
    for (const item of data.items) {
      const title = (item.title || "").replace(/<[^>]+>/g, "").trim();
      const description = (item.description || item.content || "").replace(/<[^>]+>/g, "").trim();
      const link = item.link || item.url || "";
      const pubDate = item.pubDate || new Date().toISOString();

      if (title && isRelevant(title, description, keywords)) {
        const province = detectProvince(`${title} ${description}`);
        items.push({
          id: `${sourceName}-${items.length}`,
          source: sourceName,
          title,
          description: description.substring(0, 300),
          link,
          province,
          time: timeAgo(pubDate),
          pubDate: new Date(pubDate).toISOString(),
          sentiment: detectSentiment(`${title} ${description}`),
          category: detectCategory(`${title} ${description}`),
          live: true,
          flagged: false,
          note: ""
        });
      }
      if (items.length >= 6) break;
    }
    return items;
  } catch (err) {
    console.error(`rss2json error for ${sourceName}:`, err.message);
    return [];
  }
}

export default async function handler(req, res) {
  const topicKey = req.query?.topic || "voter";
  const customKeywords = req.query?.keywords ? req.query.keywords.split(",").map(k => k.trim()) : null;
  const topic = TOPICS[topicKey] || TOPICS.voter;
  const keywords = customKeywords || topic.keywords;

  // Fetch all feeds in parallel via rss2json
  const results = await Promise.allSettled(
    RSS_FEEDS.map(f => fetchViaRss2Json(f.url, f.source, keywords))
  );

  let items = results
    .filter(r => r.status === "fulfilled")
    .flatMap(r => r.value);

  // Sort newest first
  items.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

  // Remove duplicates by title
  const seen = new Set();
  items = items.filter(item => {
    const key = item.title.toLowerCase().substring(0, 60);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate");
  res.status(200).json({
    items,
    topic: topicKey,
    topicLabel: topic.label,
    fetchedAt: new Date().toISOString(),
    liveCount: items.filter(i => i.live).length,
    totalCount: items.length,
    feedsQueried: RSS_FEEDS.length
  });
}
