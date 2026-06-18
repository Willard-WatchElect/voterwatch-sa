const TOPICS = {
  voter: {
    label: "Voter Registration",
    keywords: ["voter registration","voters roll","register to vote","IEC","electoral commission","polling station","municipal election","ward","ballot","election","registration drive","voter","voting","registration deadline","kieserregistrasie","ukuvota","ukubhalisa"],
  },
  youth: {
    label: "National Youth Day & IEC",
    keywords: ["national youth day","youth day","june 16","soweto uprising","youth month","IEC","electoral commission","young voters","youth vote","youth registration","student voters","youth parliament","NYDA","young people vote","16 june"],
  }
};

const RSS_FEEDS = [
  { url:"https://feeds.news24.com/articles/news24/SouthAfrica/rss", source:"News24" },
  { url:"https://www.dailymaverick.co.za/feed/", source:"Daily Maverick" },
  { url:"https://www.groundup.org.za/feed/", source:"GroundUp" },
  { url:"https://www.sabc.co.za/sabc/feed/", source:"SABC News" },
  { url:"https://www.iol.co.za/rss/allstories.xml", source:"IOL" },
  { url:"https://ewn.co.za/RSS%20Feeds/Latest%20News", source:"EWN" },
];

const PROVINCE_KEYWORDS = {
  "Gauteng":["gauteng","johannesburg","joburg","tshwane","pretoria","ekurhuleni","soweto","sandton"],
  "Western Cape":["western cape","cape town","stellenbosch","george","drakenstein","knysna"],
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
  if (lower.includes("concern")||lower.includes("problem")||lower.includes("fail")||lower.includes("barrier")||lower.includes("alarm")||lower.includes("closed")||lower.includes("queue")) return "negative";
  if (lower.includes("success")||lower.includes("record")||lower.includes("campaign")||lower.includes("drive")||lower.includes("momentum")||lower.includes("launch")||lower.includes("celebrat")) return "positive";
  if (lower.includes("deadline")||lower.includes("urgent")||lower.includes("warning")||lower.includes("approaching")) return "urgent";
  if (lower.includes("how")||lower.includes("confused")||lower.includes("question")) return "query";
  return "neutral";
}

function detectCategory(text) {
  const lower = text.toLowerCase();
  if (lower.includes("iec")||lower.includes("official")||lower.includes("commission")||lower.includes("minister")) return "official";
  if (lower.includes("deadline")||lower.includes("last day")||lower.includes("closes")) return "deadline";
  if (lower.includes("barrier")||lower.includes("transport")||lower.includes("load shed")) return "barrier";
  if (lower.includes("concern")||lower.includes("problem")||lower.includes("issue")) return "concern";
  return "registration";
}

function isRelevant(title, desc, keywords) {
  const text = `${title} ${desc}`.toLowerCase();
  return keywords.some(k => text.includes(k.toLowerCase()));
}

function timeAgo(dateStr) {
  try {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff/60000), hrs = Math.floor(mins/60), days = Math.floor(hrs/24);
    if (mins < 60) return `${mins} min ago`;
    if (hrs < 24) return `${hrs} hr ago`;
    return `${days} day${days>1?"s":""} ago`;
  } catch { return "recently"; }
}

async function parseFeed(feedUrl, sourceName, keywords) {
  try {
    const res = await fetch(feedUrl, {
      headers:{"User-Agent":"VoterWatchSA/4.0"},
      signal:AbortSignal.timeout(8000)
    });
    if (!res.ok) return [];
    const xml = await res.text();
    const items = [];
    const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/gi;
    let match, id=0;
    while ((match = itemRegex.exec(xml)) !== null) {
      const item = match[1];
      const title = (item.match(/<title[^>]*><!\[CDATA\[(.*?)\]\]><\/title>/i)||item.match(/<title[^>]*>(.*?)<\/title>/i)||[])[1]||"";
      const description = (item.match(/<description[^>]*><!\[CDATA\[(.*?)\]\]><\/description>/i)||item.match(/<description[^>]*>(.*?)<\/description>/i)||[])[1]||"";
      const link = (item.match(/<link[^>]*>(.*?)<\/link>/i)||[])[1]||"";
      const pubDate = (item.match(/<pubDate[^>]*>(.*?)<\/pubDate>/i)||[])[1]||"";
      const cleanTitle = title.replace(/<[^>]+>/g,"").trim();
      const cleanDesc = description.replace(/<[^>]+>/g,"").trim();
      if (cleanTitle && isRelevant(cleanTitle, cleanDesc, keywords)) {
        const province = detectProvince(`${cleanTitle} ${cleanDesc}`);
        const parsedDate = pubDate ? new Date(pubDate).toISOString() : new Date().toISOString();
        items.push({
          id:`${sourceName}-${id++}`,
          source:sourceName,
          title:cleanTitle,
          description:cleanDesc.substring(0,300),
          link:link.trim(),
          province,
          time:timeAgo(pubDate),
          pubDate:parsedDate,
          sentiment:detectSentiment(`${cleanTitle} ${cleanDesc}`),
          category:detectCategory(`${cleanTitle} ${cleanDesc}`),
          live:true,
          flagged:false,
          note:""
        });
      }
      if (items.length >= 6) break;
    }
    return items;
  } catch(err) {
    console.error(`Feed error ${sourceName}:`, err.message);
    return [];
  }
}

export default async function handler(req, res) {
  const topicKey = req.query?.topic || "voter";
  const customKeywords = req.query?.keywords ? req.query.keywords.split(",") : null;
  const topic = TOPICS[topicKey] || TOPICS.voter;
  const keywords = customKeywords || topic.keywords;

  const results = await Promise.allSettled(RSS_FEEDS.map(f => parseFeed(f.url, f.source, keywords)));
  let items = results.filter(r=>r.status==="fulfilled").flatMap(r=>r.value);
  items.sort((a,b) => new Date(b.pubDate)-new Date(a.pubDate));
  // No fallback — return empty array if no live results
  items = items.map((item,i) => ({...item, id:item.id||i}));

  res.setHeader("Cache-Control","s-maxage=300,stale-while-revalidate");
  res.status(200).json({
    items,
    topic:topicKey,
    topicLabel:topic.label,
    fetchedAt:new Date().toISOString(),
    liveCount:items.filter(i=>i.live).length,
    totalCount:items.length
  });
}
