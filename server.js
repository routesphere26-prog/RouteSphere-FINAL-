require('dotenv').config();
const express = require('express');
const cors = require('cors');
const OpenAI = require('openai');

const app = express();
const PORT = process.env.PORT || 3000;

if (!process.env.OPENAI_API_KEY) {
  console.warn('Warning: OPENAI_API_KEY is not set. Set it in a .env file before chatting.');
}
if (!process.env.GOOGLE_MAPS_API_KEY) {
  console.warn('Warning: GOOGLE_MAPS_API_KEY is not set. Warehouse search will not return real results.');
}
if (!process.env.FINNHUB_API_KEY) {
  console.warn('Warning: FINNHUB_API_KEY is not set. Live market insights will not return real data.');
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_PROMPT = `You are the RouteSphere assistant, embedded on the RouteSphere website.
RouteSphere helps startups and businesses find warehouses (including cold storage and hazmat),
compare pricing, and explore live market insights by industry and location.
Answer questions helpfully and concisely. When relevant, point users to the site's
Get Started filters (location, price range, storage type) or the Live Market Insights section.
Contact email: routesphere26@gmail.com.`;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const TYPE_LABELS = {
  'climate-controlled': 'Climate Controlled',
  'cold-storage': 'Cold Storage',
  'dry-storage': 'Dry Storage',
  'hazmat-certified': 'Hazmat Certified',
  'distribution-center': 'Distribution Center'
};

function seededRandom(seed) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return function () {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h) || 1;
}

function buildPlacesQuery(criteria) {
  const parts = ['warehouse'];
  if (criteria.type && criteria.type !== 'any' && TYPE_LABELS[criteria.type]) {
    parts.push(TYPE_LABELS[criteria.type]);
  }
  if (criteria.locationPreference === 'specific') {
    const loc = [criteria.location, criteria.state, criteria.country].filter(Boolean).join(', ');
    if (loc) parts.push(`in ${loc}`);
  }
  return parts.join(' ');
}

function buildBroadPlacesQuery(criteria) {
  const parts = ['warehouse'];
  if (criteria.locationPreference === 'specific') {
    const loc = [criteria.location, criteria.state, criteria.country].filter(Boolean).join(', ');
    if (loc) parts.push(`in ${loc}`);
  }
  return parts.join(' ');
}

function scorePlace(place) {
  const rating = place.rating || 0;
  const reviews = place.user_ratings_total || 0;
  const ratingScore = (rating / 5) * 70;
  const reviewScore = Math.min(30, Math.log10(reviews + 1) * 12);
  return Math.max(1, Math.min(100, Math.round(ratingScore + reviewScore)));
}

async function fetchPlacesForQuery(query) {
  const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${process.env.GOOGLE_MAPS_API_KEY}`;
  const resp = await fetch(url);
  const data = await resp.json();
  if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
    throw new Error(data.error_message || `Places API error: ${data.status}`);
  }
  return data.results || [];
}

async function fetchPlaces(criteria) {
  const primaryQuery = buildPlacesQuery(criteria);
  const primary = await fetchPlacesForQuery(primaryQuery);
  const valid = primary.filter(p => p.name && p.place_id);
  if (valid.length >= 3) return valid;

  const broadQuery = buildBroadPlacesQuery(criteria);
  if (broadQuery === primaryQuery) return valid;

  const broad = await fetchPlacesForQuery(broadQuery);
  const seen = new Set(valid.map(p => p.place_id));
  for (const p of broad) {
    if (p.name && p.place_id && !seen.has(p.place_id)) {
      valid.push(p);
      seen.add(p.place_id);
    }
  }
  return valid;
}

app.post('/api/warehouse-search', async (req, res) => {
  if (!process.env.GOOGLE_MAPS_API_KEY) {
    return res.status(500).json({ error: 'Warehouse search is not configured.' });
  }

  const criteria = req.body || {};

  try {
    const places = await fetchPlaces(criteria);

    const candidates = places
      .map(place => {
        const seed = hashString(place.place_id);
        const rand = seededRandom(seed);
        const priceRange = Math.max((criteria.priceMax || 50000) - (criteria.priceMin || 0), 500);
        const price = Math.round(((criteria.priceMin || 0) + rand() * priceRange) / 50) * 50;
        const sizeRange = Math.max((criteria.sizeMax || 10000) - (criteria.sizeMin || 0), 500);
        const size = Math.round(((criteria.sizeMin || 0) + rand() * sizeRange) / 50) * 50;
        const typeKey = criteria.type && criteria.type !== 'any'
          ? criteria.type
          : Object.keys(TYPE_LABELS)[Math.floor(rand() * Object.keys(TYPE_LABELS).length)];

        return {
          placeId: place.place_id,
          name: place.name,
          address: place.formatted_address || '',
          rating: place.rating || 0,
          reviewCount: place.user_ratings_total || 0,
          score: scorePlace(place),
          price,
          size,
          type: TYPE_LABELS[typeKey] || 'Distribution Center',
          material: criteria.material || 'General Goods',
          availability: criteria.availability || 'Within 30 days'
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    if (candidates.length === 0) {
      return res.json({ warehouses: [] });
    }

    try {
      const aiPrompt = `You are a warehouse-matching analyst. A user searched for a warehouse with these criteria: type=${criteria.type || 'any'}, material=${criteria.material || 'any'}, price range $${criteria.priceMin || 0}-$${criteria.priceMax || 'no max'}, size range ${criteria.sizeMin || 0}-${criteria.sizeMax || 'no max'} sq ft.

Here are the top ${candidates.length} candidate facilities, already ranked best (#1) to worst by a score out of 100 based on real Google rating and review count:
${JSON.stringify(candidates.map((c, i) => ({ rank: i + 1, name: c.name, address: c.address, rating: c.rating, reviewCount: c.reviewCount, score: c.score, type: c.type, material: c.material })))}

For EACH candidate, in the same order, write:
- "summary": a 1-2 sentence quick summary of the facility (based on its name, address, and type — write as if describing a real warehouse facility).
- "reason": 1 sentence explaining why it earned that rank, referencing its rating, review count, and fit to the search criteria.

Respond with strict JSON only, in this shape: {"results": [{"summary": "...", "reason": "..."}, ...]} with exactly ${candidates.length} items in the same order.`;

      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You respond with strict, valid JSON only, no markdown formatting.' },
          { role: 'user', content: aiPrompt }
        ],
        response_format: { type: 'json_object' },
        max_tokens: 600
      });

      const parsed = JSON.parse(completion.choices[0]?.message?.content || '{}');
      const aiResults = Array.isArray(parsed.results) ? parsed.results : [];

      candidates.forEach((c, i) => {
        c.summary = aiResults[i]?.summary || `${c.name} is a ${c.type.toLowerCase()} facility located at ${c.address}.`;
        c.reason = aiResults[i]?.reason || `Ranked #${i + 1} with a score of ${c.score}/100 based on a ${c.rating.toFixed(1)}-star rating across ${c.reviewCount} reviews.`;
      });
    } catch (aiErr) {
      console.error('OpenAI ranking request failed:', aiErr.message);
      candidates.forEach((c, i) => {
        c.summary = `${c.name} is a ${c.type.toLowerCase()} facility located at ${c.address}.`;
        c.reason = `Ranked #${i + 1} with a score of ${c.score}/100 based on a ${c.rating.toFixed(1)}-star rating across ${c.reviewCount} reviews.`;
      });
    }

    res.json({ warehouses: candidates });
  } catch (err) {
    console.error('Warehouse search failed:', err.message);
    res.status(500).json({ error: 'Warehouse search is temporarily unavailable. Please try again shortly.' });
  }
});

const INDUSTRY_TICKERS = {
  textiles: [
    { symbol: 'RL', name: 'Ralph Lauren' },
    { symbol: 'PVH', name: 'PVH Corp' },
    { symbol: 'VFC', name: 'V.F. Corporation' },
    { symbol: 'LEVI', name: 'Levi Strauss & Co.' },
    { symbol: 'UAA', name: 'Under Armour' },
    { symbol: 'GAP', name: 'Gap Inc.' },
    { symbol: 'COLM', name: 'Columbia Sportswear' },
    { symbol: 'CRI', name: 'Carter\'s' }
  ],
  electronics: [
    { symbol: 'AAPL', name: 'Apple' },
    { symbol: 'DELL', name: 'Dell Technologies' },
    { symbol: 'HPQ', name: 'HP Inc.' },
    { symbol: 'CSCO', name: 'Cisco Systems' },
    { symbol: 'INTC', name: 'Intel' },
    { symbol: 'MU', name: 'Micron Technology' },
    { symbol: 'LOGI', name: 'Logitech' },
    { symbol: 'TXN', name: 'Texas Instruments' }
  ],
  foodbeverage: [
    { symbol: 'KO', name: 'Coca-Cola' },
    { symbol: 'PEP', name: 'PepsiCo' },
    { symbol: 'GIS', name: 'General Mills' },
    { symbol: 'MDLZ', name: 'Mondelez International' },
    { symbol: 'KHC', name: 'Kraft Heinz' },
    { symbol: 'HSY', name: 'The Hershey Company' },
    { symbol: 'SBUX', name: 'Starbucks' },
    { symbol: 'CAG', name: 'Conagra Brands' }
  ],
  pharmaceuticals: [
    { symbol: 'PFE', name: 'Pfizer' },
    { symbol: 'JNJ', name: 'Johnson & Johnson' },
    { symbol: 'MRK', name: 'Merck & Co.' },
    { symbol: 'ABBV', name: 'AbbVie' },
    { symbol: 'LLY', name: 'Eli Lilly' },
    { symbol: 'BMY', name: 'Bristol-Myers Squibb' },
    { symbol: 'GILD', name: 'Gilead Sciences' },
    { symbol: 'AMGN', name: 'Amgen' }
  ],
  automotiveparts: [
    { symbol: 'APTV', name: 'Aptiv' },
    { symbol: 'BWA', name: 'BorgWarner' },
    { symbol: 'LEA', name: 'Lear Corporation' },
    { symbol: 'GT', name: 'Goodyear Tire & Rubber' },
    { symbol: 'DAN', name: 'Dana Incorporated' },
    { symbol: 'MGA', name: 'Magna International' },
    { symbol: 'ALV', name: 'Autoliv' },
    { symbol: 'GNTX', name: 'Gentex' }
  ],
  generalgoods: [
    { symbol: 'PG', name: 'Procter & Gamble' },
    { symbol: 'KMB', name: 'Kimberly-Clark' },
    { symbol: 'CL', name: 'Colgate-Palmolive' },
    { symbol: 'CHD', name: 'Church & Dwight' },
    { symbol: 'NWL', name: 'Newell Brands' },
    { symbol: 'EL', name: 'Estée Lauder' },
    { symbol: 'CLX', name: 'Clorox' },
    { symbol: 'HELE', name: 'Helen of Troy' }
  ]
};

const QUOTE_CACHE_TTL_MS = 8000;
const QUOTE_TIMEOUT_MS = 6000;
const quoteCache = new Map(); // symbol -> { price, change, changePercent, fetchedAt }

async function fetchQuote(symbol) {
  const resp = await fetch(
    `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${process.env.FINNHUB_API_KEY}`,
    { signal: AbortSignal.timeout(QUOTE_TIMEOUT_MS) }
  );
  if (!resp.ok) throw new Error(`Finnhub HTTP ${resp.status}`);
  const q = await resp.json();
  if (typeof q.c !== 'number' || q.c <= 0) throw new Error('No usable quote data');
  return {
    price: q.c,
    change: typeof q.d === 'number' ? q.d : null,
    changePercent: typeof q.dp === 'number' ? q.dp : null
  };
}

async function getQuoteForTicker(ticker) {
  const cached = quoteCache.get(ticker.symbol);
  if (cached && (Date.now() - cached.fetchedAt) < QUOTE_CACHE_TTL_MS) {
    return { symbol: ticker.symbol, name: ticker.name, price: cached.price, change: cached.change, changePercent: cached.changePercent };
  }

  const maxAttempts = 2;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await fetchQuote(ticker.symbol);
      quoteCache.set(ticker.symbol, { ...result, fetchedAt: Date.now() });
      return { symbol: ticker.symbol, name: ticker.name, ...result };
    } catch (err) {
      console.error(`Finnhub quote failed for ${ticker.symbol}:`, err.message);
      // "No usable quote data" means Finnhub has no data for this symbol at all — retrying won't help.
      if (err.message === 'No usable quote data' || attempt === maxAttempts) break;
      await new Promise(r => setTimeout(r, 400));
    }
  }

  if (cached) {
    return { symbol: ticker.symbol, name: ticker.name, price: cached.price, change: cached.change, changePercent: cached.changePercent };
  }
  return null;
}

async function getQuotesForIndustry(pool, excludeSet) {
  let preferred = pool.filter(t => !excludeSet.has(t.symbol));
  if (preferred.length < 3) preferred = pool.slice();
  preferred = [...preferred].sort(() => Math.random() - 0.5);
  const rest = pool.filter(t => !preferred.some(p => p.symbol === t.symbol));
  const tryOrder = [...preferred, ...rest];

  const quotes = [];
  const used = new Set();

  const firstBatch = tryOrder.slice(0, 3);
  const firstResults = await Promise.all(firstBatch.map(getQuoteForTicker));
  firstResults.forEach((r, i) => {
    if (r) { quotes.push(r); used.add(firstBatch[i].symbol); }
  });

  for (const ticker of tryOrder.slice(3)) {
    if (quotes.length >= 3) break;
    if (used.has(ticker.symbol)) continue;
    const r = await getQuoteForTicker(ticker);
    if (r) { quotes.push(r); used.add(ticker.symbol); }
  }

  return quotes;
}

app.get('/api/market-insights', async (req, res) => {
  const industry = req.query.industry;
  const pool = INDUSTRY_TICKERS[industry];

  if (!pool) {
    return res.status(400).json({ error: 'Unknown industry.' });
  }
  if (!process.env.FINNHUB_API_KEY) {
    return res.status(500).json({ error: 'Market insights are not configured.' });
  }

  const exclude = new Set(String(req.query.exclude || '').split(',').map(s => s.trim()).filter(Boolean));

  try {
    const quotes = await getQuotesForIndustry(pool, exclude);
    if (quotes.length === 0) {
      return res.status(503).json({ error: 'Market data is temporarily unavailable.' });
    }
    res.json({ industry, quotes });
  } catch (err) {
    console.error('Finnhub request failed:', err.message);
    res.status(500).json({ error: 'Market data is temporarily unavailable.' });
  }
});

app.post('/api/chat', async (req, res) => {
  const { messages } = req.body;
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array is required' });
  }

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
      max_tokens: 300,
    });

    const reply = completion.choices[0]?.message?.content?.trim();
    res.json({ reply: reply || "Sorry, I couldn't come up with a response." });
  } catch (err) {
    console.error('OpenAI request failed:', err.message);
    res.status(500).json({ error: 'The AI assistant is temporarily unavailable. Please try again shortly.' });
  }
});

app.listen(PORT, () => {
  console.log(`RouteSphere server running at http://localhost:${PORT}`);
});
