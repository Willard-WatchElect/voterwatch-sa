// api/feed.js — VoterWatch SA v5.1
// Fetches broad SA news via rss2json with much looser keyword filtering

const TOPICS = {
  voter: {
    label: "Voter Registration",
    keywords: [
      "voter","voting","vote","IEC","electoral","election","registration","register",
      "ballot","polling","ward","municipality","municipal","civic","democracy","democratic",
      "voters roll","registration weekend","political party","constituency","citizens",
      "public participation","iec.org.za","south africa election","sa election"
    ]
  },
  youth: {
    label: "National Youth Day & IEC",
    keywords: [
      "youth","young","june 16","16 june","soweto","uprising","nyda","student",
      "IEC","electoral","vote","register","voter","election","civic","generation",
      "youth day","national youth","youth month","youth employment","youth development",
      "young people","youth parliament","school","university"
    ]
  }
};

const RSS_FEEDS = [
  { url: "https://feeds.news24.com/articles/news24/SouthAfrica/rss", source: "News24" },
  { url: "https://www.dailymaverick.co.za/dmrss/", source: "Daily Maverick" },
  { url: "https://www.groundup.org.za/feed/", source: "GroundUp" },
  { url: "https://ewn.co.za/RSS%20Feeds/Latest%20News", source: "EWN" },
  { url: "https://www.iol.co.za/rss/allstories.xml", source: "IOL" },
  { url: "https://mg.co.za/feed", source: "Mail & Guardian" },
  { url: "https://www.timeslive.co.za/rss/", source: "TimesLIVE" },
];

const RSS2JSON_BASE = "https://api.rss2json.com/v1/api.json?count=30&rss_url=";

const PROVINCE_KEYWORDS = {
  "Gauteng":["gauteng","johannesburg","joburg","tshwane","pretoria","ekurhuleni","soweto","sandton"],
  "Western Cape":["western cape","cape town","stellenbosch","george","drakenstein","knysna","paarl"],
  "KwaZulu-Natal":["kwazulu-natal","kzn","durban","ethekwini","pietermaritzburg","newcastle"],
  "Eastern Cape":["eastern cape","buffalo city","east london","port elizabeth","gqeberha","mthatha"],
  "Limpopo":["limpopo","polokwane","mokopane","thohoyandou","tzaneen"],
  "Mpumalanga":["mpumalanga","mbombela","nelspruit","witbank","emalahleni"],
  "North West":["north west","rustenburg","mahikeng","potchefstroom","klerksdorp"],
  "Free State":["free state","mangaung","bloemfontein","welkom","bethlehem"],
  "Northern Cape":["northern cape","sol plaatje","kimberley","upington","springbok"],
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
  if (["concern","problem","fail","barrier","alarm","closed","queue","unable","reject","block","crisis","fraud","delay","low turnout","apathy"].some(w => lower.includes(w))) return "negative";
  if (["deadline","urgent","warning","approaching","last chance","final day","closes today","closes tomorrow"].some(w => lower.includes(w))) return "urgent";
  if (["success","record","increase","rise","grow","urge","encourage","launch","drive","momentum","celebrat","milestone","high turnout","improve"].some(w => lower.includes(w))) return "positive";
  return "neutral";
}

function detectCategory(text) {
  const lower = text.toLowerCase();
  if (["iec","official","commission","minister","government","announced","statement"].some(w => lower.includes(w))) return "official";
  if (["deadline","last day","closes","closing","final","time running"].some(w => lower.includes(w))) return "deadline";
  if (["barrier","transport","load shed","access","unable","no id"].some(w => lower.includes(w))) return "barrier";
  if (["concern","problem","issue","complaint","fraud","irregular"].some(w => lower.includes(w))) return "concern";
  return "registration";
}

function relevanceScore(title, desc, keywords) {
  const text = `${title} ${desc}`.toLowerCase();
  let score = 0;
  for (const keyword of keywords) {
    if (text.includes(keyword.toLowerCase())) {
      score += keyword.split(" ").length > 1 ? 3 : 1;
    }
  }
  return score;
}

function timeAgo(dateStr) {
  try {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    const hrs = Math.floor(mins / 60);
    const days = Math.floor(hrs / 24);
    if (mins < 2) return "just now";
    if (mins < 60) return `${mins} min ago`;
    if (hrs < 24) return `${hrs} hr ago`;
    return `${days} day${days > 1 ? "s" : ""} ago`;
  } catch { return "recently"; }
}

async function fetchFeed(feedUrl, sourceName, keywords) {
  try {
    const apiUrl = `${RSS2JSON_BASE}${encodeURIComponent(feedUrl)}`;
    const res = await fetch(apiUrl, { signal: AbortSignal.timeout(12000) });
    if (!res.ok) return { items: [], error: `HTTP ${res.status}` };
    const data = await res.json();
    if (data.status !== "ok" || !data.items?.length) return { items: [], error: data.message || "no items" };

    const items = [];
    for (const item of data.items) {
      const title = (item.title || "").replace(/<[^>]+>/g, "").trim();
      const description = (item.description || item.content || "").replace(/<[^>]+>/g, "").replace(/&[a-z]+;/gi, " ").trim();
      const link = item.link || item.url || item.guid || "";
      const pubDate = item.pubDate || new Date().toISOString();
      if (!title) continue;
      const score = relevanceScore(title, description, keywords);
      if (score < 1) continue;
      items.push({
        id: `${sourceName}-${items.length}`,
        source: sourceName,
        title,
        description: description.substring(0, 300),
        link: link.trim(),
        province: detectProvince(`${title} ${description}`),
        time: timeAgo(pubDate),
        pubDate: new Date(pubDate).toISOString(),
        sentiment: detectSentiment(`${title} ${description}`),
        category: detectCategory(`${title} ${description}`),
        live: true,
        flagged: false,
        note: "",
        score
      });
    }
    return { items, error: null, total: data.items.length };
  } catch (err) {
    return { items: [], error: err.message };
  }
}

export default async function handler(req, res) {
  const topicKey = req.query?.topic || "voter";
  const customKeywords = req.query?.keywords ? req.query.keywords.split(",").map(k => k.trim()).filter(Boolean) : null;
  const topic = TOPICS[topicKey] || TOPICS.voter;
  const keywords = customKeywords || topic.keywords;

  const results = await Promise.allSettled(RSS_FEEDS.map(f => fetchFeed(f.url, f.source, keywords)));

  let items = results.filter(r => r.status === "fulfilled").flatMap(r => r.value.items);

  // Deduplicate
  const seen = new Set();
  items = items.filter(item => {
    const key = item.title.toLowerCase().replace(/[^a-z0-9]/g, "").substring(0, 40);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Sort by score then date
  items.sort((a, b) => b.score !== a.score ? b.score - a.score : new Date(b.pubDate) - new Date(a.pubDate));
  items = items.map(({ score, ...item }) => item);

  // Debug info — shows in Vercel logs so we can see what's happening
  const debug = results.map((r, i) => ({
    source: RSS_FEEDS[i].source,
    status: r.status,
    relevant: r.status === "fulfilled" ? r.value.items.length : 0,
    total: r.status === "fulfilled" ? r.value.total : 0,
    error: r.status === "fulfilled" ? r.value.error : r.reason?.message
  }));

  res.setHeader("Cache-Control", "s-maxage=180, stale-while-revalidate");
  res.status(200).json({
    items,
    topic: topicKey,
    topicLabel: topic.label,
    fetchedAt: new Date().toISOString(),
    liveCount: items.length,
    totalCount: items.length,
    debug
  });
}
