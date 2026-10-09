// Local-language search terms and name keywords for warehouse search.
//
// English rules live in server.js and always apply (many listings use English names anywhere).
// These add the search country's language: hand-written tables for the languages below, and
// OpenAI-generated tables (cached per language) for every other language.
//
// Keys per language:
//   providerQueries  extra general Google searches, run on every search in that country
//   typeQueries      extra searches per warehouse type
//   provider         names that say "we store/handle goods for others" (3PL, contract logistics)
//   logistics        logistics/transport words (a carrier or broker on their own)
//   storage          business storage words
//   selfStorage      consumer self-storage words/brands
//   facility         "warehouse"/"distribution center" words used for a company's own site
//   retail           shop/outlet words
//   luggage          tourist luggage storage words
//   type             name keywords that confirm each warehouse type

const TYPES = ['climate-controlled', 'cold-storage', 'dry-storage', 'hazmat-certified', 'distribution-center'];

const BUILT_IN = {
  it: {
    providerQueries: ['logistica conto terzi', 'magazzino logistico', 'deposito merci', 'servizi di magazzinaggio'],
    typeQueries: {
      'climate-controlled': ['magazzino a temperatura controllata'],
      'cold-storage': ['celle frigorifere', 'magazzino frigorifero'],
      'dry-storage': ['magazzino merci secche'],
      'hazmat-certified': ['deposito merci pericolose', 'magazzino ADR'],
      'distribution-center': ['centro di distribuzione logistica']
    },
    provider: ['logistica conto terzi', 'conto terzi', 'magazzinaggio', 'deposito merci', 'magazzino logistico', 'stoccaggio merci', 'logistica integrata', 'magazzino frigorifero'],
    logistics: ['logistica', 'logistico', 'logistiche', 'logistici', 'trasporti', 'spedizioni', 'autotrasporti'],
    storage: ['stoccaggio', 'deposito'],
    selfStorage: ['box deposito', 'deposito mobili', 'self storage', 'easybox'],
    facility: ['magazzino', 'centro di distribuzione', 'centro distribuzione'],
    retail: ['negozio', 'supermercato', 'outlet', 'emporio'],
    luggage: ['deposito bagagli', 'bagagli'],
    type: {
      'climate-controlled': ['temperatura controllata', 'climatizzato'],
      'cold-storage': ['frigorifero', 'frigorifera', 'frigorifere', 'celle frigorifere', 'surgelati', 'catena del freddo'],
      'dry-storage': ['merci secche', 'secco'],
      'hazmat-certified': ['merci pericolose', 'ADR', 'sostanze pericolose', 'chimici'],
      'distribution-center': ['centro di distribuzione', 'distribuzione']
    }
  },
  es: {
    providerQueries: ['logística para terceros', 'almacén logístico', 'operador logístico', 'servicios de almacenaje'],
    typeQueries: {
      'climate-controlled': ['almacén con temperatura controlada'],
      'cold-storage': ['almacén frigorífico', 'cámaras frigoríficas'],
      'dry-storage': ['almacén de mercancía seca'],
      'hazmat-certified': ['almacén mercancías peligrosas', 'almacén ADR'],
      'distribution-center': ['centro de distribución logística']
    },
    provider: ['logística para terceros', 'operador logístico', 'almacenaje', 'almacenamiento de mercancías', 'logística integral', 'almacén logístico', 'almacén frigorífico'],
    logistics: ['logística', 'logistica', 'logístico', 'logistico', 'logísticos', 'transportes', 'transporte'],
    storage: ['almacenamiento', 'almacenaje'],
    selfStorage: ['trasteros', 'trastero', 'guardamuebles', 'self storage'],
    facility: ['almacén', 'almacen', 'centro de distribución', 'centro de distribucion'],
    retail: ['tienda', 'supermercado', 'outlet', 'mercado'],
    luggage: ['consigna', 'consignas', 'guarda equipajes', 'equipaje'],
    type: {
      'climate-controlled': ['temperatura controlada', 'climatizado'],
      'cold-storage': ['frigorífico', 'frigorífica', 'frigoríficos', 'cámaras frigoríficas', 'congelados', 'cadena de frío'],
      'dry-storage': ['carga seca', 'mercancía seca'],
      'hazmat-certified': ['mercancías peligrosas', 'ADR', 'químicos'],
      'distribution-center': ['centro de distribución', 'distribución']
    }
  },
  pt: {
    providerQueries: ['logística para terceiros', 'armazém logístico', 'operador logístico', 'armazenagem de mercadorias'],
    typeQueries: {
      'climate-controlled': ['armazém com temperatura controlada'],
      'cold-storage': ['armazém frigorífico', 'câmaras frigoríficas'],
      'dry-storage': ['armazém de carga seca'],
      'hazmat-certified': ['armazém produtos perigosos', 'armazenagem de cargas perigosas'],
      'distribution-center': ['centro de distribuição logística']
    },
    provider: ['logística para terceiros', 'operador logístico', 'armazenagem', 'armazéns gerais', 'logística integrada', 'armazém logístico', 'armazém frigorífico'],
    logistics: ['logística', 'logistica', 'logístico', 'logistico', 'logísticos', 'transportes', 'transportadora'],
    storage: ['armazenagem', 'armazenamento'],
    selfStorage: ['guarda-móveis', 'guarda móveis', 'self storage', 'box de armazenamento'],
    facility: ['armazém', 'armazem', 'centro de distribuição', 'centro de distribuicao'],
    retail: ['loja', 'supermercado', 'outlet', 'mercado'],
    luggage: ['guarda-volumes', 'guarda volumes', 'guarda-bagagem', 'bagagem'],
    type: {
      'climate-controlled': ['temperatura controlada', 'climatizado'],
      'cold-storage': ['frigorífico', 'frigorífica', 'frigoríficos', 'câmaras frigoríficas', 'congelados', 'cadeia do frio'],
      'dry-storage': ['carga seca'],
      'hazmat-certified': ['produtos perigosos', 'cargas perigosas', 'químicos'],
      'distribution-center': ['centro de distribuição', 'distribuição']
    }
  },
  nl: {
    providerQueries: ['logistiek dienstverlener', 'opslag en distributie', 'warehousing bedrijf', 'opslagruimte bedrijven'],
    typeQueries: {
      'climate-controlled': ['geconditioneerde opslag'],
      'cold-storage': ['koelhuis', 'vrieshuis opslag'],
      'dry-storage': ['droge opslag'],
      'hazmat-certified': ['opslag gevaarlijke stoffen', 'PGS 15 opslag'],
      'distribution-center': ['distributiecentrum logistiek']
    },
    provider: ['logistiek dienstverlener', 'opslag en distributie', 'opslagbedrijf', 'koelhuis', 'vrieshuis'],
    logistics: ['logistiek', 'transport', 'expeditie'],
    storage: ['opslag', 'opslagruimte'],
    selfStorage: ['zelfopslag', 'opslagbox', 'self storage'],
    facility: ['magazijn', 'distributiecentrum'],
    retail: ['winkel', 'supermarkt', 'outlet'],
    luggage: ['bagagedepot', 'bagagekluizen', 'bagage'],
    type: {
      'climate-controlled': ['geconditioneerd', 'geconditioneerde', 'klimaatbeheersing'],
      'cold-storage': ['koelhuis', 'vrieshuis', 'koelopslag', 'gekoeld', 'diepvries'],
      'dry-storage': ['droge opslag'],
      'hazmat-certified': ['gevaarlijke stoffen', 'PGS 15', 'ADR'],
      'distribution-center': ['distributiecentrum', 'distributie']
    }
  },
  fr: {
    providerQueries: ['logistique pour tiers', 'prestataire logistique', 'entrepôt logistique', 'stockage de marchandises'],
    typeQueries: {
      'climate-controlled': ['entrepôt à température contrôlée'],
      'cold-storage': ['entrepôt frigorifique', 'stockage frigorifique'],
      'dry-storage': ['entrepôt sec'],
      'hazmat-certified': ['stockage matières dangereuses', 'entrepôt ADR'],
      'distribution-center': ['plateforme logistique distribution']
    },
    provider: ['prestataire logistique', 'logistique pour tiers', 'entreposage', 'stockage de marchandises', 'location d\'entrepôt', 'entrepôt frigorifique', 'entrepôts frigorifiques'],
    logistics: ['logistique', 'transports', 'transport'],
    storage: ['stockage', 'entreposage'],
    selfStorage: ['garde-meuble', 'garde-meubles', 'box de stockage', 'self stockage', 'self-stockage'],
    facility: ['entrepôt', 'entrepot', 'centre de distribution'],
    retail: ['magasin', 'boutique', 'supermarché', 'outlet'],
    luggage: ['bagagerie', 'consigne', 'consignes', 'bagages'],
    type: {
      'climate-controlled': ['température contrôlée', 'climatisé'],
      'cold-storage': ['frigorifique', 'frigorifiques', 'froid', 'surgelés'],
      'dry-storage': ['sec', 'ambiant'],
      'hazmat-certified': ['matières dangereuses', 'ADR', 'produits chimiques'],
      'distribution-center': ['centre de distribution', 'distribution']
    }
  },
  de: {
    providerQueries: ['Kontraktlogistik', 'Logistikdienstleister Lager', 'Lagerlogistik', 'Lagerfläche mieten'],
    typeQueries: {
      'climate-controlled': ['temperaturgeführtes Lager'],
      'cold-storage': ['Kühllager', 'Tiefkühllager'],
      'dry-storage': ['Trockenlager'],
      'hazmat-certified': ['Gefahrstofflager', 'Gefahrgutlager'],
      'distribution-center': ['Distributionszentrum Logistik']
    },
    provider: ['Kontraktlogistik', 'Logistikdienstleister', 'Lagerlogistik', 'Einlagerung', 'Kühlhaus', 'Kühllager', 'Tiefkühllager'],
    logistics: ['Logistik', 'Spedition', 'Transporte'],
    storage: ['Lagerhaus', 'Lagerfläche', 'Lagerung'],
    selfStorage: ['Selfstorage', 'Lagerbox', 'Lagerraum mieten', 'Lagerraum'],
    facility: ['Lager', 'Zentrallager', 'Distributionszentrum'],
    retail: ['Geschäft', 'Markt', 'Outlet', 'Laden'],
    luggage: ['Gepäckaufbewahrung', 'Gepäck', 'Schließfächer'],
    type: {
      'climate-controlled': ['temperaturgeführt', 'klimatisiert'],
      'cold-storage': ['Kühllager', 'Tiefkühl', 'Kühlhaus', 'gekühlt', 'Kühllogistik'],
      'dry-storage': ['Trockenlager'],
      'hazmat-certified': ['Gefahrgut', 'Gefahrstoff', 'Gefahrstofflager', 'ADR'],
      'distribution-center': ['Distributionszentrum', 'Distribution']
    }
  }
};

const LIST_KEYS = ['providerQueries', 'provider', 'logistics', 'storage', 'selfStorage', 'facility', 'retail', 'luggage'];
const MAX_TERMS = 12;
const MAX_TERM_LENGTH = 60;

function cleanList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter(v => typeof v === 'string')
    .map(v => v.trim())
    .filter(v => v && v.length <= MAX_TERM_LENGTH))]
    .slice(0, MAX_TERMS);
}

// Keeps only well-formed string lists, so a malformed model reply can't break matching.
function normalizeVocab(raw) {
  const vocab = {};
  for (const key of LIST_KEYS) vocab[key] = cleanList(raw?.[key]);
  vocab.typeQueries = {};
  vocab.type = {};
  for (const t of TYPES) {
    vocab.typeQueries[t] = cleanList(raw?.typeQueries?.[t]).slice(0, 2);
    vocab.type[t] = cleanList(raw?.type?.[t]);
  }
  vocab.providerQueries = vocab.providerQueries.slice(0, 4);
  return vocab;
}

// The country's main language, from CLDR likely-subtags data bundled with Node ("IT" → "it").
function languageForCountry(countryCode) {
  if (!countryCode) return null;
  try {
    return new Intl.Locale(`und-${countryCode}`).maximize().language;
  } catch {
    return null;
  }
}

const generated = new Map(); // language → Promise<vocab | null>

async function generateVocab(openai, language) {
  const languageName = new Intl.DisplayNames(['en'], { type: 'language' }).of(language) || language;
  const prompt = `Translate a warehouse-search vocabulary into ${languageName} (language code "${language}").
Give the words businesses in that language actually use in their names and Google Maps listings. Use the native script.
Return strict JSON with these keys, each an array of short strings (max ${MAX_TERMS} items):
- providerQueries: 4 Google Maps searches for third-party logistics / contract warehousing providers (e.g. "third party logistics", "logistics warehouse", "goods storage services")
- provider: phrases meaning third-party logistics, contract warehousing, warehousing services
- logistics: words for logistics, transport, freight forwarding
- storage: words for business goods storage
- selfStorage: words for consumer self-storage / storage units / furniture storage
- facility: words for "warehouse" and "distribution center" (a building)
- retail: words for shop, store, supermarket, outlet
- luggage: words for tourist luggage storage / left luggage
- typeQueries: object with keys ${TYPES.map(t => `"${t}"`).join(', ')}; each an array of 2 Google Maps searches for that kind of warehouse
- type: object with the same keys; each an array of words in a business name that would confirm that warehouse type (e.g. for cold-storage: refrigerated, cold store, frozen)`;

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You respond with strict, valid JSON only, no markdown formatting.' },
        { role: 'user', content: prompt }
      ],
      response_format: { type: 'json_object' },
      max_tokens: 1200
    });
    const vocab = normalizeVocab(JSON.parse(completion.choices[0]?.message?.content || '{}'));
    console.log(`Vocabulary for "${language}" generated: ${vocab.providerQueries.join(' | ')}`);
    return vocab;
  } catch (err) {
    console.error(`Generating vocabulary for "${language}" failed:`, err.message);
    return null;
  }
}

// Returns the vocabulary for a language, or null for English / unknown / generation failure.
async function vocabularyFor(language, openai) {
  if (!language || language === 'en') return null;
  if (BUILT_IN[language]) return normalizeVocab(BUILT_IN[language]);
  if (!openai || !process.env.OPENAI_API_KEY) return null;
  if (!generated.has(language)) {
    const pending = generateVocab(openai, language);
    generated.set(language, pending);
    // Don't cache a failure forever; let the next search try again.
    pending.then(v => { if (!v) generated.delete(language); });
  }
  return generated.get(language);
}

// Scripts written without spaces between words, where "whole word" can't be checked.
const NO_SPACE_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Builds a matcher returning the first term found in a name as a whole word (Unicode-aware,
// so "móveis" and "armazém" work), or as a substring for scripts written without spaces.
function termMatcher(terms) {
  const spaced = terms.filter(t => !NO_SPACE_SCRIPT.test(t));
  const unspaced = terms.filter(t => NO_SPACE_SCRIPT.test(t));
  const re = spaced.length
    ? new RegExp(`(?<![\\p{L}\\p{N}])(${spaced.map(escapeRegex).join('|')})(?![\\p{L}\\p{N}])`, 'iu')
    : null;
  const reGlobal = re ? new RegExp(re.source, 'giu') : null;
  return {
    match(name) {
      const m = re && name.match(re);
      if (m) return m[1];
      return unspaced.find(t => name.includes(t)) || null;
    },
    strip(name) {
      let out = reGlobal ? name.replace(reGlobal, ' ') : name;
      for (const t of unspaced) out = out.split(t).join(' ');
      return out;
    }
  };
}

// Compiles a vocabulary into matchers once, so classification stays cheap.
function compileVocab(vocab) {
  if (!vocab) return null;
  const compiled = {};
  for (const key of ['provider', 'logistics', 'storage', 'selfStorage', 'facility', 'retail', 'luggage']) {
    compiled[key] = termMatcher(vocab[key]);
  }
  compiled.type = {};
  for (const t of TYPES) compiled.type[t] = termMatcher(vocab.type[t]);
  compiled.providerQueries = vocab.providerQueries;
  compiled.typeQueries = vocab.typeQueries;
  return compiled;
}

module.exports = { languageForCountry, vocabularyFor, compileVocab, termMatcher };
