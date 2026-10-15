require('dotenv').config();
const express = require('express');
const cors = require('cors');
const OpenAI = require('openai');
const { languageForCountry, vocabularyFor, compileVocab } = require('./vocabulary');

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
if (!process.env.CENSUS_API_KEY) {
  console.warn('Warning: CENSUS_API_KEY is not set. Demand Finder will try keyless Census requests, which the Census API currently rejects. Get a free key at https://api.census.gov/data/key_signup.html');
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_PROMPT = `You are the RouteSphere assistant, embedded on the RouteSphere website.
RouteSphere helps startups and businesses find warehouses (including cold storage and hazmat),
see where demand for their industry is concentrated (Demand Finder, based on annual U.S. Census data),
and explore live market insights by industry. RouteSphere does not have warehouse pricing data.
Answer questions helpfully and concisely. When relevant, point users to the site's
Get Started filters (location, radius, storage type), the Demand Finder, or the Live Market Insights section.
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

// Warehouse search targets businesses that rent space or handle goods for other businesses.
// Everything below works only from what Google Places actually returns: name, types, and
// which of our queries matched the place.
// General provider searches: these run on EVERY search, whatever type is selected (type searches
// are added on top). Google returns a varying number of results for the same query (e.g. 7–14
// for "third party logistics in Paris"), so overlapping phrasings keep results stable.
const PROVIDER_QUERIES = [
  'third party logistics',
  '3PL logistics',
  '3PL warehouse',
  'public warehouse',
  'fulfillment center',
  'commercial storage',
  'warehouse space for lease'
];

// Specific retail/consumer types: never a storage provider.
const RETAIL_TYPES = new Set([
  'shopping_mall', 'clothing_store', 'shoe_store', 'department_store', 'convenience_store',
  'home_goods_store', 'furniture_store', 'electronics_store', 'hardware_store', 'book_store',
  'jewelry_store', 'liquor_store', 'pet_store', 'bicycle_store', 'supermarket',
  'grocery_or_supermarket', 'food'
]);

// Places whose types show they're some other kind of business entirely.
const NON_PROVIDER_TYPES = new Set([
  'restaurant', 'bar', 'night_club', 'cafe', 'meal_takeaway', 'meal_delivery', 'lodging',
  'gym', 'spa', 'beauty_salon', 'hair_care', 'movie_theater', 'casino', 'church',
  'place_of_worship', 'school', 'university', 'museum', 'art_gallery', 'amusement_park',
  'bowling_alley', 'stadium', 'park', 'tourist_attraction', 'bakery', 'bank', 'atm',
  'car_dealer', 'car_rental', 'car_wash', 'gas_station', 'pharmacy', 'hospital', 'doctor',
  'dentist', 'veterinary_care', 'florist'
]);

const RETAIL_NAME = /\b(liquidations?|outlets?|(?<!cold[\s-])stores?|markets?)\b/i;
// Words that describe a company's own facility rather than a service offered to others.
const FACILITY_LABEL = /\b(warehouse|distribution cent(er|re)|fulfill?ment cent(er|re)|delivery station|dc)\b/gi;
// Name says the business stores/handles goods for others.
const PROVIDER_NAME = /\b(3pl|warehousing|fulfill?(ment)?|public warehouse|cold[\s-]?(storage|stores?)|cross-?dock|commercial storage|industrial storage|koelhuis|vrieshuis|opslagbedrijf)\b/i;
// Name says logistics/transport; on its own that can be a carrier or broker with no space.
const LOGISTICS_NAME = /\b(logistics|logistiek|logistik|logistique|supply chain|transport(ation)?|freight|trucking)\b/i;
const STORAGE_NAME = /\b(storage|opslag|lager|warehouse space|industrial (park|space|cent(er|re)))\b/i;
// Consumer self-storage, in English, French, Dutch and German ("garde-meuble", "zelfopslag", "Lagerbox").
const SELF_STORAGE_NAME = /\b(self[\s-]?storage|mini[\s-]?(storage|warehouses?)|storage rentals?|portable storage|storage units?|public storage|extra space|cubesmart|life storage|u-?haul|storquest|shurgard|homebox|une pi(e|è)ce en plus|annexx|lok'nstore|big yellow|safestore|easybox|garde[\s-]?meubles?|box(es)? de stockage|self[\s-]?stockage|zelf[\s-]?opslag|\w*opslagbox\w*|\w*lagerbox\w*|lagerr(a|ä)u?m\w*( mieten)?|box deposito|deposito mobili|trasteros?|guarda[\s-]?m(ó|o)veis)\b/i;
// Tourist luggage storage: never a business warehouse.
const LUGGAGE_NAME = /\b(luggage|baggage|left[\s-]luggage|bag storage|bagagerie|bagages?|consignes?|consignas?|bagagedepot|gepäck\w*|deposito bagagli|guarda[\s-]volumes)\b/i;
// "bag"/"bags" alone is luggage only when nothing else in the name says logistics or storage
// for businesses (so "Big Bag Logistics", a bulk-bag 3PL, isn't dropped).
const BAG_NAME = /\bbags?\b/i;
// Large retailers/brands whose facilities only serve themselves, even when named without "warehouse".
const PRIVATE_NETWORKS = /\b(amazon|walmart|meijer|target|costco|kroger|sysco|gordon food service|home depot|lowe'?s)\b/i;

// Name keywords that confirm a provider offers the requested warehouse type, in English plus the
// Dutch/German/French terms common in European listings ("koelhuis", "Gefahrgut", "frigorifique").
// Dutch "koel"/"vries" are matched only as storage compounds, so a surname like Koelewijn doesn't count.
const TYPE_KEYWORDS = {
  'climate-controlled': /\b(climate[\s-]?control\w*|temperature[\s-]?control\w*|temp[\s-]?control\w*|conditioned|geconditioneerd\w*|klimaat\w*|klimatisiert\w*)\b/i,
  'cold-storage': /\b(cold[\s-]?(storage|stores?|chain|logistics)|refrigerat\w*|reefer|freez\w*|frozen|koel(huis|huizen|cel|cellen|opslag|transport|logistiek|vries)\w*|gekoeld\w*|(diep)?vries(huis|opslag|cel)\w*|kühl\w*|tiefkühl\w*|frigo|frigorifi\w*)\b/i,
  'dry-storage': /\b(dry[\s-]?(storage|goods|warehouse)|ambient|droge?[\s-]?opslag)\b/i,
  'hazmat-certified': /\b(hazmat|haz[\s-]mat|adr|dangerous[\s-]goods|hazardous|gevaarlijke[\s-]stoffen|pgs[\s-]?15|gefahrgut|chemical|chemie\w*)\b/i,
  'distribution-center': /\b(distribution|distributie\w*|distributions\w*|cross-?dock\w*)\b/i
};

// Extra searches run when a type is selected; places they return get a small boost, but only a
// name keyword counts as confirmation.
const TYPE_QUERIES = {
  'climate-controlled': ['climate controlled warehouse', 'temperature controlled storage'],
  'cold-storage': ['cold storage warehouse', 'refrigerated warehouse'],
  'dry-storage': ['dry storage warehouse', 'ambient warehouse'],
  'hazmat-certified': ['hazmat warehouse', 'dangerous goods storage'],
  'distribution-center': ['distribution center 3PL', 'cross dock warehouse']
};

// Ranking relevance = tier + these boosts, so a confirmed type match outranks an unconfirmed
// provider one or two tiers higher, but self-storage can't beat a 3PL on keywords alone.
const TYPE_CONFIRMED_BOOST = 3;
const TYPE_SEARCH_BOOST = 1;

// Higher tier ranks first. Tiers 1 and 0 carry a caution tag on the card.
const TIER_LABELS = {
  5: '3PL / warehousing provider',
  4: 'Logistics company with storage',
  1: 'Logistics company, confirm they offer storage'
};
const CAUTION_TIERS = new Set([1]);

// Consumer storage and moving businesses: never shown as B2B warehouse providers.
const CONSUMER_NAME = /\b(moving|movers?|two men and a truck|pods|trailer leasing|truck rentals?)\b/i;
// A result must name one of these to count as a B2B warehouse; "Storage" alone isn't enough.
const B2B_NAME = /\b(contract warehousing|warehousing|warehouses?|3pl|fulfill?(ment)?|logistics|logistiek|logistik|logistique|distribution|freight|cold[\s-]?(storage|stores?)|public warehouse|cross-?dock)\b/i;

// Returns { tier, evidence } for a B2B warehouse provider, or { excluded: reason } for anything
// we shouldn't show. Every result must name a B2B warehouse term (B2B_NAME or the local equivalent).
//   5: name says warehousing/3PL/fulfillment/cold storage   → "3PL / warehousing provider"
//   4: logistics/freight/distribution name + Google "storage" or moving type
//   1: logistics/freight/distribution name, storage unconfirmed (kept so real 3PLs aren't missed)
const GENERIC_WORDS = [PROVIDER_NAME, LOGISTICS_NAME, STORAGE_NAME, FACILITY_LABEL, ...Object.values(TYPE_KEYWORDS)]
  .map(re => new RegExp(re.source, 'giu'));

function hasBusinessName(name, local) {
  let rest = name.split(',')[0]; // Google appends the address after a comma for unnamed pins
  for (const re of GENERIC_WORDS) rest = rest.replace(re, ' ');
  if (local) {
    for (const key of ['provider', 'logistics', 'storage', 'facility']) rest = local[key].strip(rest);
    for (const matcher of Object.values(local.type)) rest = matcher.strip(rest);
  }
  return /[\p{L}\p{N}]/u.test(rest);
}

// `local` is the compiled vocabulary for the search country's language (or null for English).
function classifyPlace(place, local = null) {
  const name = place.name || '';
  const localMatch = (key, text = name) => (local ? local[key].match(text) : null);
  const types = new Set(place.types || []);
  const isStorage = types.has('storage');
  const hasStorageType = isStorage || types.has('moving_company');

  const retailType = [...types].find(t => RETAIL_TYPES.has(t));
  if (retailType) return { excluded: `retail type "${retailType}"` };
  if (types.has('store') && !hasStorageType) return { excluded: 'retail store type' };
  const otherType = [...types].find(t => NON_PROVIDER_TYPES.has(t));
  if (otherType) return { excluded: `non-provider type "${otherType}"` };
  const luggageWord = name.match(LUGGAGE_NAME)?.[0] || localMatch('luggage');
  if (luggageWord) return { excluded: `luggage storage ("${luggageWord}")` };
  const retailWord = name.match(RETAIL_NAME)?.[0] || localMatch('retail');
  if (retailWord) return { excluded: `retail name ("${retailWord}")` };
  if (PRIVATE_NETWORKS.test(name)) return { excluded: `private network ("${name.match(PRIVATE_NETWORKS)[0]}")` };

  // "Founders Brewing Company Warehouse": strip the facility label and see if anything
  // left in the name says this business serves others. Local provider phrases are checked on
  // the full name, since some contain the facility word ("magazzino logistico").
  let rest = name.replace(FACILITY_LABEL, ' ');
  if (local) rest = local.facility.strip(rest);
  const providerWord = rest.match(PROVIDER_NAME)?.[0] || localMatch('provider');
  const logisticsWord = rest.match(LOGISTICS_NAME)?.[0] || localMatch('logistics', rest);
  const storageWord = rest.match(STORAGE_NAME)?.[0] || localMatch('storage', rest);
  if (BAG_NAME.test(name) && !providerWord && !logisticsWord) {
    return { excluded: `luggage storage ("${name.match(BAG_NAME)[0]}")` };
  }

  // "Cold Storage, 1-chōme-12-1 Dōgenzaka": a generic phrase plus an address is a user-dropped
  // map pin, not a business. Drop names with nothing left once generic words are removed.
  if (!hasBusinessName(name, local)) return { excluded: 'generic listing with no business name' };
  if (rest !== name && !providerWord && !logisticsWord && !storageWord) {
    return { excluded: 'company-owned facility (company name + "warehouse"/"distribution center")' };
  }
  if (types.has('real_estate_agency') && !providerWord && !storageWord) {
    return { excluded: 'real estate / office listing' };
  }

  const typeNote = isStorage ? 'Google lists it as a storage business' : 'Google lists it as a moving & storage business';

  // Consumer self-storage and movers are excluded outright, not ranked last.
  const consumerWord = name.match(SELF_STORAGE_NAME)?.[0] || name.match(CONSUMER_NAME)?.[0] || localMatch('selfStorage');
  if (consumerWord) return { excluded: `consumer storage/moving ("${consumerWord}")` };

  const b2bWord = name.match(B2B_NAME)?.[0] || localMatch('provider') || localMatch('logistics') ||
    name.match(TYPE_KEYWORDS['cold-storage'])?.[0] || (local ? local.type['cold-storage'].match(name) : null);
  // Google tags many real 3PLs as moving companies, so the type only excludes without a B2B term.
  if (types.has('moving_company') && !b2bWord) return { excluded: 'moving company (Google type, no B2B warehouse term)' };
  if (!b2bWord) return { excluded: 'no B2B warehouse term in name' };

  if (providerWord) {
    return { tier: 5, evidence: [`name says "${providerWord}"`, hasStorageType && typeNote].filter(Boolean).join('; ') };
  }
  if (hasStorageType) {
    return { tier: 4, evidence: `name says "${b2bWord}"; ${typeNote}` };
  }
  return { tier: 1, evidence: `name says "${b2bWord}"; no storage listing on Google` };
}

function milesBetween(a, b) {
  const R = 3958.8;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const lat1 = a.lat * Math.PI / 180;
  const lat2 = b.lat * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(h));
}

const geocodeCache = new Map(); // address -> { lat, lng, locality, stateCode, types } (only successful lookups are cached)

async function geocodeAddress(address) {
  if (!address || !process.env.GOOGLE_MAPS_API_KEY) return null;
  const key = address.toLowerCase();
  if (geocodeCache.has(key)) return geocodeCache.get(key);
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${process.env.GOOGLE_MAPS_API_KEY}`;
    const resp = await fetch(url);
    const data = await resp.json();
    const top = data.results?.[0];
    const point = top?.geometry?.location;
    if (!point) return null;
    const components = top.address_components || [];
    const locality = components.find(c => c.types.includes('locality'))?.long_name || null;
    const stateCode = components.find(c => c.types.includes('administrative_area_level_1'))?.short_name || null;
    const countryCode = components.find(c => c.types.includes('country'))?.short_name || null;
    const result = { lat: point.lat, lng: point.lng, locality, stateCode, countryCode, types: top.types || [] };
    if (geocodeCache.size > 2000) geocodeCache.clear();
    geocodeCache.set(key, result);
    return result;
  } catch (err) {
    console.error(`Geocoding "${address}" failed:`, err.message);
    return null;
  }
}

async function geocodeOrigin(criteria) {
  if (criteria.locationPreference !== 'specific') return null;
  const loc = [criteria.location, criteria.state, criteria.country].filter(Boolean).join(', ');
  const origin = await geocodeAddress(loc);
  console.log(origin
    ? `Search origin "${loc}" → ${origin.lat.toFixed(5)}, ${origin.lng.toFixed(5)} (${origin.types.join(', ')})`
    : `Search origin "${loc}" → not found`);
  return origin;
}

function parseRadiusMiles(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parsePoint(lat, lng) {
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln) || Math.abs(la) > 90 || Math.abs(ln) > 180) return null;
  return { lat: la, lng: ln };
}

function roundMiles(miles) {
  return Math.round(miles * 10) / 10;
}

function searchLocationText(criteria) {
  if (criteria.locationPreference !== 'specific') return '';
  return [criteria.location, criteria.state, criteria.country].filter(Boolean).join(', ');
}

// English queries say "… in Rome, Italy"; local-language ones just append the location, since
// "in" would be English inside an Italian/Spanish/… query.
function buildProviderQueries(criteria, local) {
  const loc = searchLocationText(criteria);
  const en = q => (loc ? `${q} in ${loc}` : q);
  const native = q => (loc ? `${q} ${loc}` : q);
  return [
    ...PROVIDER_QUERIES.map(q => ({ text: en(q), isType: false })),
    ...(local?.providerQueries || []).map(q => ({ text: native(q), isType: false })),
    ...(TYPE_QUERIES[criteria.type] || []).map(q => ({ text: en(q), isType: true })),
    ...(local?.typeQueries[criteria.type] || []).map(q => ({ text: native(q), isType: true }))
  ];
}

// Rating/reviews only break ties; this keeps a 5.0 from 2 reviews below a 4.7 from 100.
function ratingStrength(place) {
  const rating = place.rating || 0;
  const reviews = place.user_ratings_total || 0;
  return rating * Math.log10(reviews + 1);
}

// Places Text Search caps the bias radius at 50 km; the bias only nudges results toward
// the origin, so the real radius filter is applied afterwards with milesBetween().
const PLACES_MAX_BIAS_METERS = 50000;

async function fetchPlacesForQuery(query, origin, radiusMiles) {
  let url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${process.env.GOOGLE_MAPS_API_KEY}`;
  if (origin) {
    const biasMeters = Math.min(PLACES_MAX_BIAS_METERS, Math.round((radiusMiles || 31) * 1609.34));
    url += `&location=${origin.lat},${origin.lng}&radius=${biasMeters}`;
  }
  const resp = await fetch(url);
  const data = await resp.json();
  if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
    throw new Error(data.error_message || `Places API error: ${data.status}`);
  }
  return data.results || [];
}

// Runs every provider query and merges results by place_id, remembering which queries
// found each place (being found by several provider searches is itself a signal).
async function fetchPlaces(criteria, origin, radiusMiles, local) {
  const queries = buildProviderQueries(criteria, local);
  const settled = await Promise.allSettled(queries.map(q => fetchPlacesForQuery(q.text, origin, radiusMiles)));

  const byId = new Map();
  settled.forEach((result, i) => {
    if (result.status === 'rejected') {
      console.error(`Places query "${queries[i].text}" failed:`, result.reason.message);
      return;
    }
    for (const place of result.value) {
      if (!place.name || !place.place_id) continue;
      const entry = byId.get(place.place_id) || { place, matchedQueries: new Set(), typeSearchMatch: false };
      entry.matchedQueries.add(i);
      if (queries[i].isType) entry.typeSearchMatch = true;
      byId.set(place.place_id, entry);
    }
  });

  if (settled.every(r => r.status === 'rejected')) throw settled[0].reason;
  return [...byId.values()];
}

const MAX_WAREHOUSE_RESULTS = 3;
const LIMITED_INFO_MAX_REVIEWS = 2; // 0–2 Google reviews: too little to judge the listing
const DISTANCE_BAND_MILES = 5; // providers this close together count as equally near; rating breaks the tie

app.post('/api/warehouse-search', async (req, res) => {
  if (!process.env.GOOGLE_MAPS_API_KEY) {
    return res.status(500).json({ error: 'Warehouse search is not configured.' });
  }

  const criteria = req.body || {};
  const radiusMiles = criteria.locationPreference === 'specific' ? parseRadiusMiles(criteria.radius) : null;
  const typeKeyword = TYPE_KEYWORDS[criteria.type] || null;

  // Set when the search was launched from a Demand Finder region: ranking uses distance to
  // that region, and each card compares home base → region against warehouse → region.
  const demandInput = criteria.demand || null;
  const regionPoint = demandInput ? parsePoint(demandInput.regionLat, demandInput.regionLng) : null;
  const homePoint = demandInput ? parsePoint(demandInput.homeLat, demandInput.homeLng) : null;
  const demand = regionPoint ? {
    regionName: String(demandInput.regionName || 'this region').slice(0, 120),
    homeLabel: homePoint ? String(demandInput.homeLabel || 'Home base').slice(0, 120) : null,
    homeToRegionMiles: homePoint ? roundMiles(milesBetween(homePoint, regionPoint)) : null
  } : null;

  try {
    const origin = await geocodeOrigin(criteria);
    // Search in the country's language too (Italy → Italian, Brazil → Portuguese, …).
    const language = languageForCountry(origin?.countryCode);
    const local = compileVocab(await vocabularyFor(language, openai));
    if (local) console.log(`Warehouse search language: ${language} (${origin.countryCode})`);
    const found = await fetchPlaces(criteria, origin, radiusMiles, local);

    const notices = [];
    const applyRadius = Boolean(origin && radiusMiles);
    if (radiusMiles && !origin) {
      notices.push(`We couldn't pinpoint that location on the map, so the ${radiusMiles}-mile radius filter wasn't applied.`);
    }

    const rankFrom = regionPoint || origin;
    const rankFromLabel = demand ? demand.regionName : 'your search location';
    const filtered = [];
    const providers = [];

    for (const { place, matchedQueries, typeSearchMatch } of found) {
      const point = place.geometry?.location;
      const distanceMiles = origin && point ? roundMiles(milesBetween(origin, point)) : null;
      if (applyRadius && (distanceMiles === null || distanceMiles > radiusMiles)) {
        filtered.push([place.name, `outside ${radiusMiles} mi radius`]);
        continue;
      }
      const cls = classifyPlace(place, local);
      if (cls.excluded) {
        filtered.push([place.name, cls.excluded]);
        continue;
      }
      providers.push({
        placeId: place.place_id,
        name: place.name,
        address: place.formatted_address || '',
        rating: place.rating || 0,
        reviewCount: place.user_ratings_total || 0,
        tier: cls.tier,
        kind: TIER_LABELS[cls.tier],
        caution: CAUTION_TIERS.has(cls.tier),
        limitedInfo: (place.user_ratings_total || 0) <= LIMITED_INFO_MAX_REVIEWS,
        evidence: cls.evidence,
        typeConfirmedBy: typeKeyword
          ? place.name.match(typeKeyword)?.[0] || (local ? local.type[criteria.type].match(place.name) : null)
          : null,
        typeSearchMatch,
        distanceMiles,
        rankDistanceMiles: rankFrom && point ? roundMiles(milesBetween(rankFrom, point)) : null,
        regionDistanceMiles: regionPoint && point ? roundMiles(milesBetween(point, regionPoint)) : null,
        strength: ratingStrength(place)
      });
    }

    if (filtered.length) {
      console.log(`Warehouse search "${searchLocationText(criteria) || 'anywhere'}": filtered ${filtered.length} of ${found.length} places`);
      filtered.forEach(([name, why]) => console.log(`  - ${name}: ${why}`));
    }

    // Relevance first (tier, boosted for the requested type), then distance in 5-mile bands,
    // then rating strength as the tiebreaker.
    const relevance = w => w.tier +
      (w.typeConfirmedBy ? TYPE_CONFIRMED_BOOST : 0) +
      (w.typeSearchMatch ? TYPE_SEARCH_BOOST : 0);
    const band = d => (d === null ? Infinity : Math.floor(d / DISTANCE_BAND_MILES));
    providers.sort((a, b) =>
      relevance(b) - relevance(a) ||
      band(a.rankDistanceMiles) - band(b.rankDistanceMiles) ||
      b.strength - a.strength
    );
    const results = providers.slice(0, MAX_WAREHOUSE_RESULTS);

    results.forEach((w, i) => {
      const bits = [`#${i + 1}: ${w.kind} (${w.evidence})`];
      if (typeKeyword) {
        const typeName = TYPE_LABELS[criteria.type].toLowerCase();
        if (w.typeConfirmedBy) {
          w.typeNote = `${TYPE_LABELS[criteria.type]}: name says "${w.typeConfirmedBy}"`;
          bits.push(`name confirms ${typeName}`);
        } else {
          w.typeNote = 'Type not confirmed, ask the provider.';
          if (w.typeSearchMatch) bits.push(`found by our ${typeName} search, not confirmed`);
        }
        w.typeConfirmed = Boolean(w.typeConfirmedBy);
      }
      if (w.rankDistanceMiles !== null) bits.push(`${w.rankDistanceMiles} mi from ${rankFromLabel}`);
      if (w.reviewCount) bits.push(`${w.rating.toFixed(1)}★ from ${w.reviewCount} review${w.reviewCount === 1 ? '' : 's'}`);
      w.rankReason = bits.join(' · ');
    });

    if (typeKeyword && results.length && !results.some(w => w.typeConfirmed)) {
      const near = demand ? demand.regionName : (capitalizeWords(searchLocationText(criteria)) || 'your search');
      notices.push(`No providers near ${near} confirm ${TYPE_LABELS[criteria.type].toLowerCase()} by name. Showing general providers. Ask each one directly.`);
    }

    // Never pad with excluded places; say how many real B2B warehouses there are instead.
    if (results.length < MAX_WAREHOUSE_RESULTS) {
      const count = results.length ? `Only ${results.length} B2B warehouse${results.length === 1 ? '' : 's'}` : 'No B2B warehouses';
      notices.push(applyRadius
        ? `${count} found within ${radiusMiles} mi. Try a larger radius.`
        : `${count} found for this search.`);
    }

    const warehouses = results.map(({ strength, rankDistanceMiles, typeConfirmedBy, typeSearchMatch, ...w }) => w);
    res.json({ warehouses, radiusMiles: applyRadius ? radiusMiles : null, demand, notices });
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

/* ------------------------------------------------------------
   Demand Finder — U.S. Census County Business Patterns + ACS
   ------------------------------------------------------------ */

// Latest vintages on api.census.gov as of Oct 2026 (CBP 2024 returns 404).
const CBP_YEAR = '2023';
const ACS_YEAR = '2024'; // ACS 5-year, 2020–2024
const METRO_GEO = 'metropolitan statistical area/micropolitan statistical area';
const CENSUS_CACHE_TTL_MS = 12 * 60 * 60 * 1000; // source data changes once a year

// CBP 2023 data is coded in NAICS 2017: the API variable is NAICS2017 and the 2022 retail
// codes (455, 456110, 4581…) appear in its code list but return no data. Every code below was
// checked against live CBP 2023 data. These are BUYER industries, i.e. businesses that purchase
// what a seller in each industry makes. Codes within an industry never nest, so counts can be summed.
const INDUSTRY_BUYERS = {
  textiles: {
    label: 'Textiles',
    codes: [{ code: '4481', label: 'Clothing & clothing accessories stores' }]
  },
  electronics: {
    label: 'Electronics',
    codes: [{ code: '443', label: 'Electronics & appliance stores' }]
  },
  foodbeverage: {
    label: 'Food & Beverage',
    codes: [
      { code: '4451', label: 'Grocery stores' },
      { code: '722511', label: 'Full-service restaurants' }
    ]
  },
  pharmaceuticals: {
    label: 'Pharmaceuticals',
    codes: [
      { code: '446110', label: 'Pharmacies & drug stores' },
      { code: '622', label: 'Hospitals' }
    ]
  },
  automotiveparts: {
    label: 'Automotive Parts',
    codes: [
      { code: '8111', label: 'Automotive repair & maintenance' },
      { code: '4411', label: 'Automobile dealers' }
    ]
  },
  generalgoods: {
    label: 'General Goods',
    codes: [{ code: '452', label: 'General merchandise stores' }]
  }
};

// Best-match score weights (points out of 100). Buyer count is log-scaled so the biggest
// counties don't win on size alone; concentration is the location quotient (see scoreRegions).
const SCORE_WEIGHTS = { buyers: 30, concentration: 40, proximity: 30 };
// Only the regions with the most buyers are scored, and each needs a minimum buyer count,
// so a tiny county with 2 stores and 900 residents can't top the list on per-capita numbers.
const DEMAND_POOL_SIZE = 40;
const MIN_POOL_BUYERS = 5;
const MIN_POOL_SHARE_OF_TOP = 0.05;
// Location quotients from few buyers are noisy (a resort town with 20 shops looks hugely
// specialized), so each LQ is blended toward 1.0 (the reference average); at this many buyers
// it's a 50/50 blend.
const LQ_SHRINK_BUYERS = 40;
// An adjusted LQ at or above this earns full concentration points; 1.0 (average) earns half.
const LQ_FULL_POINTS = 2;
// Closeness halves every this many miles from the home city (full points at 0 mi).
const PROXIMITY_HALF_MILES = { state: 150, national: 300 };

const STATES = [
  ['AL', '01', 'Alabama'], ['AK', '02', 'Alaska'], ['AZ', '04', 'Arizona'], ['AR', '05', 'Arkansas'],
  ['CA', '06', 'California'], ['CO', '08', 'Colorado'], ['CT', '09', 'Connecticut'], ['DE', '10', 'Delaware'],
  ['DC', '11', 'District of Columbia'], ['FL', '12', 'Florida'], ['GA', '13', 'Georgia'], ['HI', '15', 'Hawaii'],
  ['ID', '16', 'Idaho'], ['IL', '17', 'Illinois'], ['IN', '18', 'Indiana'], ['IA', '19', 'Iowa'],
  ['KS', '20', 'Kansas'], ['KY', '21', 'Kentucky'], ['LA', '22', 'Louisiana'], ['ME', '23', 'Maine'],
  ['MD', '24', 'Maryland'], ['MA', '25', 'Massachusetts'], ['MI', '26', 'Michigan'], ['MN', '27', 'Minnesota'],
  ['MS', '28', 'Mississippi'], ['MO', '29', 'Missouri'], ['MT', '30', 'Montana'], ['NE', '31', 'Nebraska'],
  ['NV', '32', 'Nevada'], ['NH', '33', 'New Hampshire'], ['NJ', '34', 'New Jersey'], ['NM', '35', 'New Mexico'],
  ['NY', '36', 'New York'], ['NC', '37', 'North Carolina'], ['ND', '38', 'North Dakota'], ['OH', '39', 'Ohio'],
  ['OK', '40', 'Oklahoma'], ['OR', '41', 'Oregon'], ['PA', '42', 'Pennsylvania'], ['RI', '44', 'Rhode Island'],
  ['SC', '45', 'South Carolina'], ['SD', '46', 'South Dakota'], ['TN', '47', 'Tennessee'], ['TX', '48', 'Texas'],
  ['UT', '49', 'Utah'], ['VT', '50', 'Vermont'], ['VA', '51', 'Virginia'], ['WA', '53', 'Washington'],
  ['WV', '54', 'West Virginia'], ['WI', '55', 'Wisconsin'], ['WY', '56', 'Wyoming']
].map(([abbr, fips, name]) => ({ abbr, fips, name }));
const STATE_BY_ABBR = new Map(STATES.map(s => [s.abbr, s]));

class CensusKeyError extends Error {}

// Census expects ':' '/' ',' and '*' unescaped in geography clauses.
function censusEncode(value) {
  return encodeURIComponent(value).replace(/%3A/g, ':').replace(/%2F/g, '/').replace(/%2C/g, ',');
}

// Returns rows as objects keyed by the header row. 204 (no data for this query) -> [].
async function censusGet(dataset, params) {
  const query = Object.entries(params).map(([k, v]) => `${k}=${censusEncode(v)}`);
  if (process.env.CENSUS_API_KEY) query.push(`key=${encodeURIComponent(process.env.CENSUS_API_KEY)}`);
  const resp = await fetch(`https://api.census.gov/data/${dataset}?${query.join('&')}`, {
    redirect: 'manual',
    signal: AbortSignal.timeout(15000)
  });
  // Missing/invalid keys are answered with a redirect to missing_key.html / invalid_key.html.
  if (resp.headers.get('x-datawebapi-keyerror') || (resp.status >= 300 && resp.status < 400)) {
    throw new CensusKeyError(process.env.CENSUS_API_KEY ? 'Census API rejected CENSUS_API_KEY.' : 'Census API requires a key.');
  }
  if (resp.status === 204) return [];
  if (!resp.ok) throw new Error(`Census HTTP ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  const [header, ...rows] = await resp.json();
  return rows.map(r => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

const censusCache = new Map(); // cache key -> { value, fetchedAt }

async function cachedCensus(key, loader) {
  const hit = censusCache.get(key);
  if (hit && Date.now() - hit.fetchedAt < CENSUS_CACHE_TTL_MS) return hit.value;
  const value = await loader();
  censusCache.set(key, { value, fetchedAt: Date.now() });
  return value;
}

function geoClause(scope, state) {
  return scope === 'state'
    ? { for: 'county:*', in: `state:${state.fips}` }
    : { for: `${METRO_GEO}:*` };
}

function regionId(row, scope) {
  return scope === 'state' ? `${row.state}${row.county}` : row[METRO_GEO];
}

// Sums buyer establishments (ESTAB) across the industry's buyer NAICS codes, per county or metro.
async function fetchEstablishments(industryKey, scope, state) {
  const codes = INDUSTRY_BUYERS[industryKey].codes;
  const perCode = await Promise.all(codes.map(({ code }) =>
    cachedCensus(`cbp:${scope}:${state?.fips || 'us'}:${code}`, () =>
      censusGet(`${CBP_YEAR}/cbp`, { get: 'NAME,ESTAB', NAICS2017: code, ...geoClause(scope, state) })
    )
  ));

  const regions = new Map();
  const codesWithData = [];
  perCode.forEach((rows, i) => {
    let used = false;
    for (const row of rows) {
      // EMPSZES/LFO default to "001" (all establishments); skip any size/legal-form breakdown rows.
      if (row.EMPSZES && row.EMPSZES !== '001') continue;
      if (row.LFO && row.LFO !== '001') continue;
      // County 999 is CBP's "Statewide" bucket for establishments with no fixed county.
      if (scope === 'state' && row.county === '999') continue;
      const estab = parseInt(row.ESTAB, 10);
      if (!Number.isFinite(estab) || estab <= 0) continue;

      const id = regionId(row, scope);
      const region = regions.get(id) || { id, name: row.NAME, establishments: 0, breakdown: [] };
      region.establishments += estab;
      region.breakdown.push({ code: codes[i].code, establishments: estab });
      regions.set(id, region);
      used = true;
    }
    if (used) codesWithData.push(codes[i].code);
  });

  return { regions: [...regions.values()], codesWithData };
}

// All-sector establishment totals (NAICS "00") per region: the denominator of each region's share.
async function fetchTotalEstablishments(scope, state) {
  const rows = await cachedCensus(`cbp:${scope}:${state?.fips || 'us'}:00`, () =>
    censusGet(`${CBP_YEAR}/cbp`, { get: 'NAME,ESTAB', NAICS2017: '00', ...geoClause(scope, state) })
  );
  const byId = new Map();
  for (const row of rows) {
    const total = parseInt(row.ESTAB, 10);
    if (Number.isFinite(total) && total > 0) byId.set(regionId(row, scope), total);
  }
  return byId;
}

// The reference share for the location quotient: buyers ÷ all establishments for the whole
// state (county search) or the whole U.S. (metro search, since metros cross state lines).
async function fetchReferenceShare(industryKey, scope, state) {
  const geo = scope === 'state' ? { for: `state:${state.fips}` } : { for: 'us:*' };
  const refKey = scope === 'state' ? state.fips : 'us';
  const codes = [...INDUSTRY_BUYERS[industryKey].codes.map(c => c.code), '00'];
  const counts = await Promise.all(codes.map(code =>
    cachedCensus(`cbp:ref:${refKey}:${code}`, () => censusGet(`${CBP_YEAR}/cbp`, { get: 'ESTAB', NAICS2017: code, ...geo }))
      .then(rows => parseInt(rows[0]?.ESTAB, 10) || 0)
  ));
  const total = counts.pop();
  const buyers = counts.reduce((sum, n) => sum + n, 0);
  return { buyers, total, share: total ? buyers / total : null, label: scope === 'state' ? state.name : 'the U.S.' };
}

async function fetchPopulation(scope, state) {
  const rows = await cachedCensus(`acs:${scope}:${state?.fips || 'us'}`, () =>
    censusGet(`${ACS_YEAR}/acs/acs5`, { get: 'NAME,B01003_001E', ...geoClause(scope, state) })
  );
  const byId = new Map();
  for (const row of rows) {
    const pop = parseInt(row.B01003_001E, 10);
    // ACS uses large negative sentinels (e.g. -666666666) for "not available".
    if (Number.isFinite(pop) && pop >= 0) byId.set(regionId(row, scope), pop);
  }
  return byId;
}

const TIGERWEB = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb';

// Official Census internal points (INTPTLAT/INTPTLON) for every county in a state, or every
// metro/micro area, keyed by the same GEOID the CBP/ACS rows use.
async function fetchRegionPoints(scope, state) {
  return cachedCensus(`tiger:${scope}:${state?.fips || 'us'}`, async () => {
    const layers = scope === 'state'
      ? [{ path: 'State_County/MapServer/1', where: `STATE='${state.fips}'` }]
      : [{ path: 'CBSA/MapServer/3', where: '1=1' }, { path: 'CBSA/MapServer/4', where: '1=1' }];
    const points = new Map();
    for (const { path, where } of layers) {
      const url = `${TIGERWEB}/${path}/query?where=${encodeURIComponent(where)}&outFields=GEOID,INTPTLAT,INTPTLON&returnGeometry=false&f=json`;
      const resp = await fetch(url, { signal: AbortSignal.timeout(20000) });
      const data = await resp.json();
      if (!Array.isArray(data.features)) throw new Error(`TIGERweb ${path}: ${data.error?.message || 'no features'}`);
      for (const { attributes: a } of data.features) {
        const point = parsePoint(a.INTPTLAT, a.INTPTLON);
        if (point) points.set(a.GEOID, point);
      }
    }
    return points;
  });
}

// What the warehouse search should look for: counties by name, metros by their first
// principal city, e.g. "Detroit-Warren-Dearborn, MI Metro Area" → Detroit, MI.
function regionSearchTarget(region, scope, state) {
  if (scope === 'state') {
    const county = region.name.split(',')[0].trim();
    return { location: county, state: state.abbr, country: 'USA', label: `${county}, ${state.abbr}` };
  }
  const [cities, rest = ''] = region.name.split(',');
  const city = cities.split('-')[0].split('/')[0].trim();
  const metroState = STATE_BY_ABBR.get(rest.trim().split(/\s+/)[0].split('-')[0]);
  return {
    location: city,
    state: metroState ? metroState.abbr : '',
    country: 'USA',
    label: region.name.replace(/ (Metro|Micro) Area$/, '')
  };
}

// Geocoder result types that mean "this is a city/town", as opposed to Google falling back to
// the whole state when it can't find the name.
const CITY_RESULT_TYPES = new Set([
  'locality', 'sublocality', 'sublocality_level_1', 'postal_town', 'administrative_area_level_3',
  'neighborhood', 'colloquial_area'
]);

// "rome, italy" → "Rome, Italy"; leaves the rest of each word alone so "USA" stays "USA".
function capitalizeWords(text) {
  return text.replace(/(^|[\s,-])(\p{L})/gu, (m, sep, letter) => sep + letter.toUpperCase());
}

function titleCase(text) {
  return text.toLowerCase().replace(/(^|[\s-])\p{L}/gu, m => m.toUpperCase());
}

// Scores the pool 0–100:
//   buyers         log10(buyers) vs. the pool's largest
//   concentration  location quotient = (region buyers / region establishments) ÷ reference share,
//                  blended toward 1.0 for low counts; LQ_FULL_POINTS or more = full points
//   proximity      halves every PROXIMITY_HALF_MILES from the home city
// If a part can't be computed for a region, it's left out and the remaining weights are rescaled.
function scoreRegions(pool, halfMiles) {
  const maxLogBuyers = Math.max(...pool.map(r => Math.log10(r.establishments + 1)));

  for (const r of pool) {
    let concentration = null;
    if (r.locationQuotient !== null) {
      const w = r.establishments / (r.establishments + LQ_SHRINK_BUYERS);
      r.adjustedLocationQuotient = Math.round((w * r.locationQuotient + (1 - w)) * 100) / 100;
      concentration = Math.min(r.adjustedLocationQuotient, LQ_FULL_POINTS) / LQ_FULL_POINTS;
    }
    const parts = {
      buyers: maxLogBuyers > 0 ? Math.log10(r.establishments + 1) / maxLogBuyers : 0,
      concentration,
      proximity: r.homeDistanceMiles !== null ? 0.5 ** (r.homeDistanceMiles / halfMiles) : null
    };
    let earned = 0;
    let possible = 0;
    r.scoreParts = {};
    for (const [key, weight] of Object.entries(SCORE_WEIGHTS)) {
      if (parts[key] === null) {
        r.scoreParts[key] = null;
        continue;
      }
      const pts = parts[key] * weight;
      r.scoreParts[key] = { points: Math.round(pts), of: weight };
      earned += pts;
      possible += weight;
    }
    r.score = possible ? Math.round((earned / possible) * 100) : 0;
  }
}

// Census place names carry a legal suffix ("Grand Rapids city", "Holland charter township",
// "Urban Honolulu CDP") and sometimes a county qualifier ("Alton CDP (Starr County)").
const PLACE_SUFFIX = /\s+(city and borough|city|town|village|borough|CDP|municipality|comunidad|zona urbana|(consolidated|metro|metropolitan|unified) government|urban county)$/i;

function cleanPlaceName(censusName) {
  return censusName.split(',')[0].replace(/\s*\([^)]*\)$/, '').replace(PLACE_SUFFIX, '').trim();
}

// Cities, towns and villages in a state (ACS place list), largest population first, for the
// Market Finder's home-city suggestions.
app.get('/api/places', async (req, res) => {
  const state = STATE_BY_ABBR.get(String(req.query.state || '').toUpperCase());
  if (!state) return res.status(400).json({ error: 'Unknown state.' });
  try {
    const rows = await cachedCensus(`acs:place:${state.fips}`, () =>
      censusGet(`${ACS_YEAR}/acs/acs5`, { get: 'NAME,B01003_001E', for: 'place:*', in: `state:${state.fips}` })
    );
    const byName = new Map();
    for (const row of rows) {
      const name = cleanPlaceName(row.NAME);
      const pop = parseInt(row.B01003_001E, 10);
      if (!name || !Number.isFinite(pop) || pop < 0) continue;
      if (!byName.has(name) || byName.get(name) < pop) byName.set(name, pop);
    }
    const places = [...byName.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
    res.json({ state: state.abbr, places });
  } catch (err) {
    console.error('Census place list request failed:', err.message);
    res.status(503).json({ error: 'City suggestions are unavailable right now. You can still type your city.' });
  }
});

app.get('/api/demand-finder', async (req, res) => {
  const industryKey = String(req.query.industry || '');
  const industry = INDUSTRY_BUYERS[industryKey];
  const state = STATE_BY_ABBR.get(String(req.query.state || '').toUpperCase());
  const city = String(req.query.city || '').trim().slice(0, 100);
  const scope = req.query.scope === 'national' ? 'national' : 'state';

  if (!industry) return res.status(400).json({ error: 'Unknown industry.' });
  if (!state) return res.status(400).json({ error: 'Please choose your home base state.' });

  console.log(`Market Finder: industry=${industryKey} state=${state.abbr} scope=${scope} city="${city}" NAICS=${industry.codes.map(c => c.code).join(',')}`);

  try {
    const [{ regions, codesWithData }, totals, reference, population, points, home] = await Promise.all([
      fetchEstablishments(industryKey, scope, state),
      fetchTotalEstablishments(scope, state),
      fetchReferenceShare(industryKey, scope, state),
      fetchPopulation(scope, state).catch(err => {
        console.error('ACS population request failed:', err.message);
        return new Map();
      }),
      fetchRegionPoints(scope, state).catch(err => {
        console.error('TIGERweb region points request failed:', err.message);
        return new Map();
      }),
      geocodeAddress([city, state.name, 'USA'].filter(Boolean).join(', '))
    ]);

    const byBuyers = regions.sort((a, b) => b.establishments - a.establishments);
    const minBuyers = Math.max(MIN_POOL_BUYERS, Math.ceil((byBuyers[0]?.establishments || 0) * MIN_POOL_SHARE_OF_TOP));
    const eligible = byBuyers.filter(r => r.establishments >= minBuyers);
    // Sparse states/industries: never show fewer than 5 regions just because of the floor.
    const pool = (eligible.length >= 5 ? eligible : byBuyers.slice(0, 5))
      .slice(0, DEMAND_POOL_SIZE)
      .map(region => {
        const pop = population.has(region.id) ? population.get(region.id) : null;
        const point = points.get(region.id) || null;
        const total = totals.get(region.id) || null;
        const lq = total && reference.share ? (region.establishments / total) / reference.share : null;
        return {
          id: region.id,
          name: region.name,
          establishments: region.establishments,
          breakdown: region.breakdown,
          totalEstablishments: total,
          locationQuotient: lq === null ? null : Math.round(lq * 100) / 100,
          population: pop,
          lat: point?.lat ?? null,
          lng: point?.lng ?? null,
          homeDistanceMiles: home && point ? roundMiles(milesBetween(home, point)) : null,
          search: regionSearchTarget(region, scope, state)
        };
      });
    scoreRegions(pool, PROXIMITY_HALF_MILES[scope]);
    pool.sort((a, b) => b.score - a.score);

    // A typed city must resolve to a real place in the chosen state; never use the state's center.
    if (city && process.env.GOOGLE_MAPS_API_KEY) {
      const isCity = home && home.stateCode === state.abbr && home.types.some(t => CITY_RESULT_TYPES.has(t));
      if (!isCity) {
        return res.status(400).json({
          error: `Couldn't find that city in ${state.name}. Check the spelling or pick from the list.`,
          field: 'city'
        });
      }
    }

    const homeCity = city ? (home?.locality || titleCase(city)) : '';
    res.json({
      industry: industryKey,
      industryLabel: industry.label,
      scope,
      cbpYear: CBP_YEAR,
      acsLabel: `${Number(ACS_YEAR) - 4}–${ACS_YEAR} ACS 5-year estimates`,
      naics: industry.codes.map(c => ({ ...c, hasData: codesWithData.includes(c.code) })),
      weights: SCORE_WEIGHTS,
      reference: { label: reference.label, buyers: reference.buyers, total: reference.total },
      lqShrinkBuyers: LQ_SHRINK_BUYERS,
      lqFullPoints: LQ_FULL_POINTS,
      proximityHalfMiles: PROXIMITY_HALF_MILES[scope],
      poolSize: pool.length,
      minBuyers,
      home: home ? { label: [homeCity, state.abbr].filter(Boolean).join(', '), lat: home.lat, lng: home.lng } : null,
      regions: pool
    });
  } catch (err) {
    if (err instanceof CensusKeyError) {
      console.error(`Demand Finder: ${err.message} Add CENSUS_API_KEY to .env (free: https://api.census.gov/data/key_signup.html).`);
      return res.status(503).json({
        error: process.env.CENSUS_API_KEY
          ? 'Census demand data is unavailable: the Census API rejected this server\'s API key.'
          : 'Census demand data is unavailable: the Census API requires an API key and none is configured on this server.'
      });
    }
    console.error('Demand Finder request failed:', err.message);
    res.status(500).json({ error: 'Census demand data is temporarily unavailable. Please try again shortly.' });
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
