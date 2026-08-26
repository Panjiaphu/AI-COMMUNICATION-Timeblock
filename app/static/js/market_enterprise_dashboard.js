(() => {
  if (window.TimeblockMarketEnterprise && window.TimeblockMarketEnterprise.loadIntelligence) return;

  const state = {
    promise: null,
    payload: null,
    error: null,
  };

  const currentLocale = () => {
    const params = new URLSearchParams(window.location.search || '');
    return params.get('lang') || document.documentElement.lang || 'vi';
  };

  const endpoint = () => `/market/intelligence.json?lang=${encodeURIComponent(currentLocale())}`;
  const dictionary = () => (state.payload && state.payload.i18n) || {};
  const t = (key, fallback) => dictionary()[key] || fallback || key;

  const shell = () => document.querySelector('.market-shell');
  const setShellError = () => {
    const currentShell = shell();
    if (!currentShell || currentShell.dataset.marketShellState !== 'loading') return;
    currentShell.dataset.marketShellState = 'error';
    const message = currentShell.querySelector('[data-market-shell-message]');
    if (message) message.textContent = currentShell.dataset.marketShellError || 'Market data is temporarily unavailable.';
  };

  const hydrateShell = (payload) => {
    const currentShell = shell();
    if (!currentShell || currentShell.dataset.marketShellState !== 'loading') return;
    const hydrateUrl = payload && payload.hydrate_url;
    if (!hydrateUrl) return;
    currentShell.dataset.marketShellState = 'hydrating';
    window.location.replace(hydrateUrl);
  };

  const fetchPayload = () => fetch(endpoint(), { headers: { Accept: 'application/json' } })
    .then((response) => {
      if (!response.ok) throw new Error(`market intelligence ${response.status}`);
      return response.json();
    })
    .then((payload) => {
      state.payload = payload || {};
      state.error = null;
      document.dispatchEvent(new CustomEvent('timeblock:market-intelligence-ready', { detail: state.payload }));
      hydrateShell(state.payload);
      return state.payload;
    })
    .catch((error) => {
      state.error = error;
      state.promise = null;
      setShellError();
      document.dispatchEvent(new CustomEvent('timeblock:market-intelligence-error', { detail: error }));
      throw error;
    });

  const loadIntelligence = () => {
    if (state.payload) return Promise.resolve(state.payload);
    if (!state.promise) state.promise = fetchPayload();
    return state.promise;
  };

  window.TimeblockMarketEnterprise = Object.assign(window.TimeblockMarketEnterprise || {}, {
    loadIntelligence,
    getPayload: () => state.payload,
    getError: () => state.error,
    i18n: dictionary,
    t,
    locale: currentLocale,
  });

  const start = () => {
    if (shell()) loadIntelligence().catch(() => {});
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
