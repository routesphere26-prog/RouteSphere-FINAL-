/* ============================================================
   RouteSphere — site interactivity
   (Globe intro animation lives inline in index.html; everything
   else — nav, filters, live insights, demand finder — lives here.)
   ============================================================ */

document.addEventListener('DOMContentLoaded', () => {
  initTopbarNav();
  initLocationToggle();
  initFilterForm();
  initLiveInsights();
  initDemandFinder();
});

/* ------------------------------------------------------------
   Topbar navigation + panels
   ------------------------------------------------------------ */

function initTopbarNav() {
  const panels = document.querySelectorAll('.panel[data-panel], .panel.overlay');
  const openButtons = document.querySelectorAll('[data-panel]');
  const homeButton = document.getElementById('homeButton');

  function panelFor(name) {
    return document.getElementById(`${name}Panel`);
  }

  function closeAllPanels() {
    document.querySelectorAll('.panel.overlay').forEach(p => p.classList.add('hidden'));
  }

  function openPanel(name) {
    closeAllPanels();
    const panel = panelFor(name);
    if (panel) panel.classList.remove('hidden');
  }

  openButtons.forEach(btn => {
    btn.addEventListener('click', () => openPanel(btn.dataset.panel));
  });

  document.querySelectorAll('[data-close="panel"]').forEach(btn => {
    btn.addEventListener('click', () => closeAllPanels());
  });

  document.querySelectorAll('.panel.overlay').forEach(panel => {
    panel.addEventListener('click', (e) => {
      if (e.target === panel) closeAllPanels();
    });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeAllPanels();
      if (typeof window.RS_closeResults === 'function') window.RS_closeResults();
    }
  });

  if (homeButton) {
    homeButton.addEventListener('click', () => {
      closeAllPanels();
      if (typeof window.RS_closeResults === 'function') window.RS_closeResults();
      if (typeof window.RS_replayAndSettle === 'function') {
        window.RS_replayAndSettle();
      } else {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    });
  }
}

/* ------------------------------------------------------------
   Location preference toggle
   ------------------------------------------------------------ */

function initLocationToggle() {
  const specificBtn = document.getElementById('specificLocationBtn');
  const dontCareBtn = document.getElementById('dontCareBtn');
  const hiddenInput = document.getElementById('locationPreference');
  const locationFields = document.getElementById('locationFields');
  const countryInput = document.getElementById('countryInput');
  const stateField = document.getElementById('stateField');

  if (specificBtn && dontCareBtn) {
    specificBtn.addEventListener('click', () => {
      specificBtn.classList.add('active');
      dontCareBtn.classList.remove('active');
      hiddenInput.value = 'specific';
      locationFields.classList.remove('hidden');
    });

    dontCareBtn.addEventListener('click', () => {
      dontCareBtn.classList.add('active');
      specificBtn.classList.remove('active');
      hiddenInput.value = 'any';
      locationFields.classList.add('hidden');
    });
  }

  if (countryInput && stateField) {
    countryInput.addEventListener('input', () => {
      const val = countryInput.value.trim().toLowerCase();
      // State only applies to the United States; shown while Country is still empty too.
      const isUS = val === '' || val === 'us' || val === 'usa' || val === 'united states' || val === 'united states of america';
      stateField.classList.toggle('hidden', !isUS);
    });
  }
}

/* ------------------------------------------------------------
   Filter form: validation, loading overlay, results
   ------------------------------------------------------------ */

const LOADING_MESSAGES = [
  'Scanning Warehouses...',
  'Filtering out stores & company-owned warehouses...',
  'Checking distance to your target area...',
  'Ranking your best matches...'
];

// Radius used when a Demand Finder region launches a search and the form has none.
const DEFAULT_REGION_RADIUS_MILES = 50;

function initFilterForm() {
  const form = document.getElementById('filterForm');
  const resetBtn = document.getElementById('resetFilters');
  const warning = document.getElementById('searchWarning');
  const loadingOverlay = document.getElementById('loadingOverlay');
  const loadingMessage = document.getElementById('loadingMessage');
  const loadingClose = document.getElementById('loadingClose');
  const viewResultsButton = document.getElementById('viewResultsButton');
  const filterResults = document.getElementById('filterResults');
  const resultsScreen = document.getElementById('resultsScreen');
  const resultsClose = document.getElementById('resultsClose');
  const resultsList = document.getElementById('resultsList');
  const resultsContext = document.getElementById('resultsContext');

  if (!form) return;

  function openResultsScreen() {
    resultsScreen.classList.remove('hidden');
    resultsScreen.scrollTop = 0;
    document.body.classList.add('scroll-locked');
  }

  function closeResultsScreen() {
    resultsScreen.classList.add('hidden');
    document.body.classList.remove('scroll-locked');
  }

  window.RS_closeResults = closeResultsScreen;
  resultsClose?.addEventListener('click', closeResultsScreen);

  let loadingTimers = [];

  function clearLoadingTimers() {
    loadingTimers.forEach(t => { clearTimeout(t); clearInterval(t); });
    loadingTimers = [];
  }

  function hideLoadingOverlay() {
    clearLoadingTimers();
    loadingOverlay.classList.add('hidden');
    viewResultsButton.classList.add('hidden');
  }

  resetBtn?.addEventListener('click', () => {
    form.reset();
    document.getElementById('specificLocationBtn')?.classList.add('active');
    document.getElementById('dontCareBtn')?.classList.remove('active');
    document.getElementById('locationPreference').value = 'specific';
    document.getElementById('locationFields')?.classList.remove('hidden');
    document.getElementById('stateField')?.classList.remove('hidden'); // Country is empty again after reset
    warning?.classList.add('hidden');
    filterResults.innerHTML = '';
  });

  loadingClose?.addEventListener('click', hideLoadingOverlay);

  function showWarning(text) {
    warning.textContent = text;
    warning.classList.remove('hidden');
    warning.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // Reads the form into search criteria, or returns { error } if it can't be searched.
  function readCriteria() {
    const data = new FormData(form);
    const locationPreference = data.get('locationPreference') || 'specific';
    const location = (data.get('location') || '').trim();
    const country = (data.get('country') || '').trim();
    const radiusRaw = String(data.get('radius') || '').trim();

    if (locationPreference === 'specific' && !location && !country) {
      return { error: 'Please enter a location (or choose "Don\'t Care") before searching.' };
    }
    if (radiusRaw && !(Number(radiusRaw) > 0)) {
      return { error: 'Radius must be a number greater than 0, or left blank.' };
    }

    return {
      criteria: {
        locationPreference,
        location,
        country,
        state: data.get('state') || '',
        radius: radiusRaw,
        type: data.get('type') || 'any'
      }
    };
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    warning.classList.add('hidden');
    const { criteria, error } = readCriteria();
    if (error) {
      showWarning(error);
      return;
    }
    runSearch(criteria);
  });

  // Called by the Demand Finder: fills the form with the region (so the user can see and
  // tweak what was searched), then runs the search with home/region coordinates attached.
  window.RS_searchRegion = function (region, home) {
    warning.classList.add('hidden');
    document.getElementById('specificLocationBtn')?.click();
    document.getElementById('locationInput').value = region.search.location;
    const countryInput = document.getElementById('countryInput');
    countryInput.value = region.search.country;
    countryInput.dispatchEvent(new Event('input'));
    document.getElementById('stateSelect').value = region.search.state;
    const radiusInput = document.getElementById('radiusInput');
    if (!(Number(radiusInput.value) > 0)) radiusInput.value = DEFAULT_REGION_RADIUS_MILES;

    const { criteria, error } = readCriteria();
    if (error) {
      showWarning(error);
      return;
    }
    if (region.lat !== null && region.lng !== null) {
      criteria.demand = {
        regionName: region.search.label,
        regionLat: region.lat,
        regionLng: region.lng,
        homeLabel: home ? home.label : null,
        homeLat: home ? home.lat : null,
        homeLng: home ? home.lng : null
      };
    }
    runSearch(criteria);
  };

  async function runSearch(criteria) {
    clearLoadingTimers();
    loadingOverlay.classList.remove('hidden');
    viewResultsButton.classList.add('hidden');

    let msgIndex = 0;
    loadingMessage.textContent = LOADING_MESSAGES[0];
    loadingMessage.classList.add('fade-in');
    loadingTimers.push(setInterval(() => {
      msgIndex = (msgIndex + 1) % LOADING_MESSAGES.length;
      loadingMessage.textContent = LOADING_MESSAGES[msgIndex];
      loadingMessage.classList.remove('fade-in');
      void loadingMessage.offsetWidth;
      loadingMessage.classList.add('fade-in');
    }, 650));

    try {
      const resp = await fetch('/api/warehouse-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(criteria)
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Warehouse search failed.');

      clearLoadingTimers();
      const warehouses = data.warehouses || [];
      renderResultsSummary(filterResults, warehouses, criteria, data);
      renderResultsContext(resultsContext, data);
      renderWarehouseCards(resultsList, warehouses, data.demand);
      viewResultsButton.classList.remove('hidden');
    } catch (err) {
      clearLoadingTimers();
      loadingMessage.classList.remove('fade-in');
      loadingMessage.textContent = err.message || 'Something went wrong. Please try again.';
    }
  }

  viewResultsButton?.addEventListener('click', () => {
    hideLoadingOverlay();
    if (typeof window.RS_finishIntro === 'function') window.RS_finishIntro();
    openResultsScreen();
  });
}

function describeSearchArea(criteria, data) {
  const where = criteria.locationPreference === 'any'
    ? 'anywhere'
    : [criteria.location, criteria.state, criteria.country].filter(Boolean).join(', ') || 'your area';
  return data.radiusMiles ? `within ${data.radiusMiles} mi of ${where}` : `near ${where}`;
}

function renderResultsSummary(container, warehouses, criteria, data) {
  container.innerHTML = '';
  if (warehouses.length) return;

  const summary = document.createElement('p');
  summary.className = 'results-summary';
  summary.textContent = `No matching warehouses found ${describeSearchArea(criteria, data)}. Try widening your search criteria.`;
  container.appendChild(summary);
}

function renderResultsContext(el, data) {
  if (!el) return;
  el.innerHTML = '';
  if (data.radiusMiles) {
    const radius = document.createElement('p');
    radius.textContent = `Showing warehouses within ${data.radiusMiles} mi of your search location.`;
    el.appendChild(radius);
  }
  // Server notices (unconfirmed type, fewer than 3 providers, radius not applied) are warnings.
  (data.notices || []).forEach(text => {
    const note = document.createElement('p');
    note.className = 'results-notice';
    note.textContent = text;
    el.appendChild(note);
  });
  el.classList.toggle('hidden', !el.childElementCount);
}

/* ------------------------------------------------------------
   Warehouse result cards
   ------------------------------------------------------------ */

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

function formatMiles(miles) {
  return typeof miles === 'number' ? `${miles.toLocaleString()} mi` : 'N/A';
}

function renderWarehouseCards(container, warehouses, demand) {
  container.innerHTML = '';

  if (!warehouses.length) {
    const empty = document.createElement('p');
    empty.className = 'results-summary';
    empty.textContent = 'No matching warehouses found for that search. Try widening your criteria.';
    container.appendChild(empty);
    return;
  }

  warehouses.forEach((w, i) => {
    const rating = w.rating || 0;
    const fullStars = Math.round(rating);
    const stars = '★'.repeat(fullStars) + '☆'.repeat(5 - fullStars);

    // With a demand region, the region comparison below replaces the plain distance line.
    const distanceLine = !demand && typeof w.distanceMiles === 'number'
      ? `<div class="warehouse-meta">${formatMiles(w.distanceMiles)} from your search location</div>`
      : '';

    const demandBlock = demand ? `
      <div class="warehouse-demand">
        ${demand.homeToRegionMiles !== null ? `<div><span>Home base → ${escapeHtml(demand.regionName)}</span><strong>${formatMiles(demand.homeToRegionMiles)}</strong></div>` : ''}
        <div><span>Warehouse → ${escapeHtml(demand.regionName)}</span><strong>${formatMiles(w.regionDistanceMiles)}</strong></div>
        <p>Straight-line distances, not driving routes.</p>
      </div>` : '';

    const card = document.createElement('div');
    card.className = 'warehouse-card fade-in';
    card.innerHTML = `
      <div class="warehouse-card-header">
        <div class="warehouse-rank">#${i + 1}</div>
        <div class="warehouse-name">${escapeHtml(w.name)}</div>
      </div>
      <div class="card-tags">
        <div class="card-tag${w.caution ? ' card-tag--caution' : ''}">${escapeHtml(w.kind)}</div>
        ${w.limitedInfo ? '<div class="card-tag card-tag--caution">Limited info, verify before contacting</div>' : ''}
      </div>
      <div class="warehouse-meta">${escapeHtml(w.address)}</div>
      ${distanceLine}
      ${w.reviewCount ? `<div class="warehouse-rating">
        <span class="warehouse-stars">${stars}</span>
        <span>${rating.toFixed(1)}</span>
        <span class="warehouse-review-count">(${w.reviewCount.toLocaleString()} review${w.reviewCount === 1 ? '' : 's'})</span>
      </div>` : ''}
      ${w.typeNote ? `<div class="warehouse-type-note${w.typeConfirmed ? ' confirmed' : ''}">${escapeHtml(w.typeNote)}</div>` : ''}
      ${demandBlock}
      <p class="warehouse-reason"><strong>Why this rank —</strong> ${escapeHtml(w.rankReason)}</p>
    `;
    container.appendChild(card);
  });
}

/* ------------------------------------------------------------
   Demand Finder (annual U.S. Census County Business Patterns)
   ------------------------------------------------------------ */

function initDemandFinder() {
  const form = document.getElementById('demandForm');
  const stateSelect = document.getElementById('demandState');
  const scopeInput = document.getElementById('demandScope');
  const status = document.getElementById('demandStatus');
  const resultsEl = document.getElementById('demandResults');
  const sourceEl = document.getElementById('demandSource');
  const sortBar = document.getElementById('demandSort');
  if (!form) return;

  let lastResult = null;
  let sortMode = 'best';

  sortBar?.querySelectorAll('[data-sort]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      sortMode = btn.dataset.sort;
      sortBar.querySelectorAll('[data-sort]').forEach(b => b.classList.toggle('active', b === btn));
      if (lastResult) renderDemandRegions(resultsEl, lastResult, sortMode);
    });
  });

  // Reuse the warehouse form's state list rather than duplicating it. "Select state" is a
  // placeholder only: disabled so it can't be picked back, and greyed out while showing.
  stateSelect.innerHTML = document.getElementById('stateSelect')?.innerHTML || '';
  if (stateSelect.options[0]) {
    stateSelect.options[0].disabled = true;
    stateSelect.selectedIndex = 0;
  }
  initCitySuggestions(stateSelect, document.getElementById('demandCity'), document.getElementById('demandCityOptions'));

  form.querySelectorAll('[data-scope]').forEach(btn => {
    btn.addEventListener('click', () => {
      form.querySelectorAll('[data-scope]').forEach(b => b.classList.toggle('active', b === btn));
      scopeInput.value = btn.dataset.scope;
    });
  });

  function showStatus(text) {
    status.textContent = text;
    status.classList.toggle('hidden', !text);
  }

  document.getElementById('resetDemand')?.addEventListener('click', () => {
    requestId++; // ignore any search still in flight
    form.reset();
    // form.reset() would pick the first real state; go back to the "Select state" placeholder,
    // which also disables and empties the city box.
    stateSelect.selectedIndex = 0;
    stateSelect.dispatchEvent(new Event('change'));
    scopeInput.value = 'state';
    form.querySelectorAll('[data-scope]').forEach(b => b.classList.toggle('active', b.dataset.scope === 'state'));
    sortMode = 'best';
    lastResult = null;
    sortBar?.classList.add('hidden');
    resultsEl.innerHTML = '';
    sourceEl.classList.add('hidden');
    showStatus('');
  });

  let requestId = 0;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = new FormData(form);
    if (!data.get('state')) {
      showStatus('Please choose your home base state.');
      stateSelect.focus();
      return;
    }

    const thisRequest = ++requestId;
    resultsEl.innerHTML = '';
    sourceEl.classList.add('hidden');
    sortBar?.classList.add('hidden');
    showStatus('Loading Census data...');

    try {
      const params = new URLSearchParams({
        industry: data.get('industry'),
        city: (data.get('city') || '').trim(),
        state: data.get('state'),
        scope: data.get('scope')
      });
      const resp = await fetch(`/api/demand-finder?${params.toString()}`);
      const result = await resp.json();
      if (thisRequest !== requestId) return;
      if (!resp.ok) {
        if (result.field === 'city') document.getElementById('demandCity')?.focus();
        throw new Error(result.error || 'Census demand data is unavailable.');
      }

      if (!result.regions.length) {
        showStatus(`The Census reports no potential ${result.industryLabel} buyers in this area.`);
        return;
      }
      showStatus(result.home ? '' : 'We couldn\'t locate your home base on the map, so distance isn\'t part of the score.');

      lastResult = result;
      const closestBtn = sortBar?.querySelector('[data-sort="closest"]');
      if (closestBtn) closestBtn.disabled = !result.home;
      if (sortMode === 'closest' && !result.home) sortMode = 'best';
      sortBar?.querySelectorAll('[data-sort]').forEach(b => b.classList.toggle('active', b.dataset.sort === sortMode));
      sortBar?.classList.remove('hidden');
      renderDemandRegions(resultsEl, result, sortMode);
      renderDemandSource(sourceEl, result);
    } catch (err) {
      if (thisRequest !== requestId) return;
      showStatus(err.message || 'Census demand data is unavailable.');
    }
  });
}

const DEMAND_SORTS = {
  best: (a, b) => b.score - a.score,
  buyers: (a, b) => b.establishments - a.establishments,
  closest: (a, b) => (a.homeDistanceMiles ?? Infinity) - (b.homeDistanceMiles ?? Infinity)
};

function formatLq(lq) {
  return typeof lq === 'number' ? `${lq.toFixed(2)}×` : 'N/A';
}

function describeScore(r, result) {
  const parts = r.scoreParts;
  const bits = [`${r.establishments.toLocaleString()} buyers (${parts.buyers.points}/${parts.buyers.of})`];
  if (parts.concentration) bits.push(`${formatLq(r.locationQuotient)} ${result.reference.label}'s share of these businesses (${parts.concentration.points}/${parts.concentration.of})`);
  if (parts.proximity) bits.push(`${formatMiles(r.homeDistanceMiles)} from home (${parts.proximity.points}/${parts.proximity.of})`);
  return bits.join(' · ');
}

// Fills the city box with the chosen state's cities (Census place list, largest first).
// The box stays free text, so a city that isn't listed can still be typed.
function initCitySuggestions(stateSelect, cityInput, datalist) {
  if (!cityInput || !datalist) return;
  let requestId = 0;

  stateSelect.addEventListener('change', async () => {
    const state = stateSelect.value;
    stateSelect.classList.toggle('is-empty', !state);
    const thisRequest = ++requestId;
    datalist.innerHTML = '';
    cityInput.value = ''; // a city always belongs to the previous state, even if the name repeats
    cityInput.disabled = !state;
    cityInput.placeholder = state ? 'Loading cities...' : 'Select a state first';
    if (!state) return;

    try {
      const resp = await fetch(`/api/places?state=${encodeURIComponent(state)}`);
      const data = await resp.json();
      if (thisRequest !== requestId) return;
      if (!resp.ok) throw new Error(data.error);
      datalist.innerHTML = data.places.map(name => `<option value="${escapeHtml(name)}"></option>`).join('');
      cityInput.placeholder = 'Type or pick a city';
    } catch (err) {
      if (thisRequest !== requestId) return;
      cityInput.placeholder = 'Type your city';
    }
  });
}

function renderDemandRegions(container, result, sortMode = 'best') {
  container.innerHTML = '';
  const naicsLabels = Object.fromEntries(result.naics.map(n => [n.code, n.label]));
  const regions = [...result.regions].sort(DEMAND_SORTS[sortMode] || DEMAND_SORTS.best).slice(0, 5);

  regions.forEach((r, i) => {
    const breakdown = r.breakdown
      .map(b => `<li><span>${escapeHtml(naicsLabels[b.code] || '')} (NAICS ${escapeHtml(b.code)})</span><span>${b.establishments.toLocaleString()}</span></li>`)
      .join('');

    const card = document.createElement('div');
    card.className = 'demand-card fade-in';
    card.innerHTML = `
      <div class="warehouse-card-header">
        <div class="warehouse-rank">#${i + 1}</div>
        <div class="warehouse-name">${escapeHtml(r.name)}</div>
      </div>
      <div class="card-tag">Match ${r.score}/100</div>
      <div class="demand-stats">
        <div><span class="demand-stat-num">${r.establishments.toLocaleString()}</span><span class="demand-stat-label">Potential buyers</span></div>
        <div><span class="demand-stat-num">${formatLq(r.locationQuotient)}</span><span class="demand-stat-label">Concentration vs. ${escapeHtml(result.reference.label)}</span></div>
        <div><span class="demand-stat-num">${r.population !== null ? r.population.toLocaleString() : 'N/A'}</span><span class="demand-stat-label">Population (ACS est.)</span></div>
      </div>
      ${typeof r.homeDistanceMiles === 'number' ? `<div class="warehouse-meta">${formatMiles(r.homeDistanceMiles)} from ${escapeHtml(result.home.label)} (straight line)</div>` : ''}
      <p class="demand-score-note"><strong>Why ${r.score}/100 —</strong> ${escapeHtml(describeScore(r, result))}</p>
      <details class="demand-breakdown">
        <summary>Potential buyers by type</summary>
        <ul>${breakdown}</ul>
      </details>
      <button type="button" class="secondary-button demand-search-btn">Find warehouses here</button>
    `;
    card.querySelector('.demand-search-btn').addEventListener('click', () => {
      window.RS_searchRegion?.(r, result.home);
    });
    container.appendChild(card);
  });
}

function renderDemandSource(el, result) {
  const codes = result.naics.map(n => `${n.code} ${n.label}`).join('; ');
  const missing = result.naics.filter(n => !n.hasData).map(n => n.code);
  el.textContent =
    'Estimated demand based on U.S. Census data (updated annually). ' +
    `Potential buyers: County Business Patterns ${result.cbpYear} establishment counts for businesses that buy ${result.industryLabel.toLowerCase()} products (NAICS ${codes}). ` +
    `Population: ${result.acsLabel}. ` +
    'These count buyer locations, not sales or order volumes. ' +
    `Best match (out of 100) compares the top ${result.poolSize} areas with at least ${result.minBuyers} buyers: buyer count, log-scaled (${result.weights.buyers} pts); ` +
    `concentration, i.e. the location quotient: the area's share of all its businesses that are these buyers, divided by ${result.reference.label}'s share ` +
    `(1.00× = same as ${result.reference.label}; ${result.lqFullPoints.toFixed(2)}× or more = full ${result.weights.concentration} pts; areas with few buyers are blended toward 1.00× so a handful of shops can't dominate); ` +
    `and closeness to your home city (${result.weights.proximity} pts, halving every ${result.proximityHalfMiles} mi).` +
    (missing.length ? ` No data was published for NAICS ${missing.join(', ')} in this area.` : '');
  el.classList.remove('hidden');
}

/* ------------------------------------------------------------
   Live market insights
   ------------------------------------------------------------ */

const INSIGHTS_REFRESH_SECONDS = 10;

function initLiveInsights() {
  const select = document.getElementById('industrySelect');
  const cardsContainer = document.getElementById('insightsCards');
  const countdownEl = document.getElementById('insightsCountdown');
  if (!select || !cardsContainer) return;

  let seconds = INSIGHTS_REFRESH_SECONDS;
  let lastSymbols = [];
  let requestId = 0;

  async function renderInsights() {
    const industry = select.value;
    const thisRequest = ++requestId;

    try {
      const params = new URLSearchParams({ industry, exclude: lastSymbols.join(',') });
      const resp = await fetch(`/api/market-insights?${params.toString()}`);
      const data = await resp.json();
      if (thisRequest !== requestId) return;
      if (!resp.ok) throw new Error(data.error || 'Failed to load market data.');

      const quotes = data.quotes || [];
      lastSymbols = quotes.map(q => q.symbol);

      cardsContainer.innerHTML = '';
      quotes.forEach(q => {
        const price = typeof q.price === 'number' ? q.price : null;
        const change = typeof q.change === 'number' ? q.change : null;
        const pct = typeof q.changePercent === 'number' ? q.changePercent : null;
        const dir = (pct ?? 0) >= 0 ? 'up' : 'down';
        const arrow = (pct ?? 0) >= 0 ? '▲' : '▼';
        const sign = (change ?? 0) >= 0 ? '+' : '';

        const el = document.createElement('div');
        el.className = 'insight-card fade-in';
        el.innerHTML = `
          <div class="insight-card-label">${escapeHtml(q.name)}</div>
          <div class="insight-card-value">${price !== null ? `$${price.toFixed(2)}` : 'N/A'}</div>
          <div class="insight-card-trend ${dir}">${arrow} Change: ${pct !== null ? `${sign}${pct.toFixed(2)}%` : 'N/A'}${change !== null ? ` (${sign}${change.toFixed(2)})` : ''}</div>
        `;
        cardsContainer.appendChild(el);
      });
    } catch (err) {
      if (thisRequest !== requestId) return;
      cardsContainer.innerHTML = '<p class="results-summary">Live market data is temporarily unavailable.</p>';
    }
  }

  select.addEventListener('change', () => {
    seconds = INSIGHTS_REFRESH_SECONDS;
    lastSymbols = [];
    renderInsights();
  });

  renderInsights();

  setInterval(() => {
    seconds -= 1;
    if (seconds <= 0) {
      seconds = INSIGHTS_REFRESH_SECONDS;
      renderInsights();
    }
    if (countdownEl) countdownEl.textContent = `Next update in ${seconds}s`;
  }, 1000);
}

