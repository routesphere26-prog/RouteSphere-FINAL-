/* ============================================================
   RouteSphere — site interactivity
   (Globe intro animation lives inline in index.html; everything
   else — nav, filters, live insights — lives here.)
   ============================================================ */

document.addEventListener('DOMContentLoaded', () => {
  initTopbarNav();
  initLocationToggle();
  initAutocompleteFields();
  initFilterForm();
  initLiveInsights();
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
      const isUS = val === 'us' || val === 'usa' || val === 'united states' || val === 'united states of america';
      stateField.classList.toggle('hidden', !isUS);
    });
  }
}

/* ------------------------------------------------------------
   Autocomplete helpers (Availability / Material)
   ------------------------------------------------------------ */

const AVAILABILITY_OPTIONS = [
  'Immediate', 'Within 1 week', 'Within 2 weeks', 'Within 30 days',
  'Within 60 days', 'Within 90 days', 'Seasonal (Q4 peak)', 'Flexible / Negotiable'
];

const MATERIAL_OPTIONS = [
  'Beds & Furniture', 'Batteries', 'Electronics', 'Apparel & Textiles',
  'Perishable Food', 'Frozen Goods', 'Pharmaceuticals', 'Auto Parts',
  'Raw Materials', 'Packaging Supplies', 'Chemicals (Non-Hazmat)', 'General Merchandise'
];

function initAutocompleteFields() {
  wireAutocomplete('availabilityInput', 'availabilityHelper', AVAILABILITY_OPTIONS);
  wireAutocomplete('materialInput', 'materialHelper', MATERIAL_OPTIONS);
}

function wireAutocomplete(inputId, helperId, options) {
  const input = document.getElementById(inputId);
  const helper = document.getElementById(helperId);
  if (!input || !helper) return;

  function render(list) {
    helper.innerHTML = '';
    if (!list.length) {
      helper.classList.add('hidden');
      return;
    }
    list.forEach(opt => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'autocomplete-option';
      btn.textContent = opt;
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        input.value = opt;
        helper.classList.add('hidden');
      });
      helper.appendChild(btn);
    });
    helper.classList.remove('hidden');
  }

  input.addEventListener('focus', () => {
    const query = input.value.trim().toLowerCase();
    const list = query
      ? options.filter(o => o.toLowerCase().includes(query))
      : options;
    render(list);
  });

  input.addEventListener('input', () => {
    const query = input.value.trim().toLowerCase();
    const list = query
      ? options.filter(o => o.toLowerCase().includes(query))
      : options;
    render(list);
  });

  input.addEventListener('blur', () => {
    setTimeout(() => helper.classList.add('hidden'), 120);
  });
}

/* ------------------------------------------------------------
   Filter form: validation, loading overlay, results
   ------------------------------------------------------------ */

const LOADING_MESSAGES = [
  'Scanning Warehouses...',
  'Cross-referencing availability...',
  'Evaluating pricing & fit...',
  'Ranking your best matches...'
];

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
    document.getElementById('stateField')?.classList.add('hidden');
    warning?.classList.add('hidden');
    filterResults.innerHTML = '';
  });

  loadingClose?.addEventListener('click', hideLoadingOverlay);

  const REQUIRED_FIELDS = [
    { key: 'priceMin', label: 'Price Min ($)' },
    { key: 'priceMax', label: 'Price Max ($)' },
    { key: 'sizeMin', label: 'Size Min (sq ft)' },
    { key: 'sizeMax', label: 'Size Max (sq ft)' },
    { key: 'availability', label: 'Availability' },
    { key: 'material', label: 'Material' },
    { key: 'type', label: 'Type' }
  ];

  function showWarning(text) {
    warning.textContent = text;
    warning.classList.remove('hidden');
    warning.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    warning.classList.add('hidden');

    const data = new FormData(form);
    const locationPreference = data.get('locationPreference') || 'specific';
    const location = (data.get('location') || '').trim();
    const country = (data.get('country') || '').trim();

    const missing = REQUIRED_FIELDS
      .filter(f => !String(data.get(f.key) || '').trim())
      .map(f => f.label);

    if (locationPreference === 'specific' && !location && !country) {
      missing.unshift('Location');
    }

    if (missing.length) {
      showWarning(`Please fill out the following before searching: ${missing.join(', ')}.`);
      return;
    }

    const criteria = {
      locationPreference,
      location,
      country,
      state: data.get('state') || '',
      radius: data.get('radius') || '',
      priceMin: Number(data.get('priceMin')),
      priceMax: Number(data.get('priceMax')),
      sizeMin: Number(data.get('sizeMin')),
      sizeMax: Number(data.get('sizeMax')),
      availability: (data.get('availability') || '').trim(),
      material: (data.get('material') || '').trim(),
      type: data.get('type') || ''
    };

    if (criteria.priceMin > criteria.priceMax) {
      showWarning('Price Min can\'t be greater than Price Max.');
      return;
    }

    if (criteria.sizeMin > criteria.sizeMax) {
      showWarning('Size Min can\'t be greater than Size Max.');
      return;
    }

    runSearch(criteria);
  });

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
      renderResultsSummary(filterResults, warehouses, criteria);
      renderWarehouseCards(resultsList, warehouses);
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

function renderResultsSummary(container, warehouses, criteria) {
  container.innerHTML = '';
  if (warehouses.length) return;

  const summary = document.createElement('p');
  summary.className = 'results-summary';
  const where = criteria.locationPreference === 'any'
    ? 'anywhere'
    : [criteria.location, criteria.state, criteria.country].filter(Boolean).join(', ') || 'your area';
  summary.textContent = `No matching warehouses found near ${where}. Try widening your search criteria.`;
  container.appendChild(summary);
}

/* ------------------------------------------------------------
   Warehouse result cards
   ------------------------------------------------------------ */

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

function renderWarehouseCards(container, warehouses) {
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

    const card = document.createElement('div');
    card.className = 'warehouse-card fade-in';
    card.innerHTML = `
      <div class="warehouse-card-header">
        <div class="warehouse-rank">#${i + 1}</div>
        <div class="warehouse-name">${escapeHtml(w.name)}</div>
        <div class="warehouse-match">${w.score}<span>/100</span></div>
      </div>
      <div class="warehouse-meta">${escapeHtml(w.address)}</div>
      <div class="warehouse-rating">
        <span class="warehouse-stars">${stars}</span>
        <span>${rating.toFixed(1)}</span>
        <span class="warehouse-review-count">(${(w.reviewCount || 0).toLocaleString()} reviews)</span>
      </div>
      <p class="warehouse-summary"><strong>AI Summary —</strong> ${escapeHtml(w.summary)}</p>
      <p class="warehouse-reason"><strong>Why #${i + 1} —</strong> ${escapeHtml(w.reason)}</p>
    `;
    container.appendChild(card);
  });
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

