(() => {
  const shell = document.querySelector('.market-shell');
  if (!shell || shell.dataset.enterprisePhase1 === 'ready') return;
  shell.dataset.enterprisePhase1 = 'ready';

  const locale = document.documentElement.lang || 'vi';
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const makeT = (payload) => (key, fallback) => ((payload && payload.i18n && payload.i18n[key]) || fallback || key);

  const normalize = (quality) => {
    if (!quality || typeof quality !== 'object') return [];
    if (Array.isArray(quality.items) && quality.items.length) return quality.items;
    return ['coingecko', 'binance', 'futures', 'defillama', 'fear_greed', 'updated_at'].map((key) => ({
      key,
      status: quality[key] || (key === 'updated_at' ? 'live' : 'fallback'),
      tone: quality[key] || 'fallback',
      value: key === 'updated_at' ? (quality.updated_at || '-') : (quality[key] || 'fallback')
    }));
  };

  const render = (payload) => {
    const quality = (payload && payload.data_quality) || {};
    const t = makeT(payload);
    if (shell.querySelector('.market-enterprise-quality')) return;
    const items = normalize(quality);
    const panel = document.createElement('section');
    panel.className = 'market-panel market-enterprise-quality market-collapsible';
    panel.setAttribute('aria-label', t('market.data_quality.title'));
    panel.innerHTML = `
      <div class="market-panel-header">
        <div>
          <p class="eyebrow">${esc(t('market.enterprise.eyebrow'))}</p>
          <h2>${esc(t('market.data_quality.title'))}</h2>
        </div>
        <span class="market-note">${esc(t('market.data_quality.note'))}</span>
      </div>
      <div class="market-data-quality-grid">
        ${items.map((item) => {
          const status = item.status || 'fallback';
          const tone = item.tone || status;
          const value = item.key === 'updated_at' ? (item.value || quality.updated_at || '-') : t(`market.data_quality.${status}`, status);
          return `<article class="market-data-quality-card quality-${esc(tone)}"><span>${esc(t(`market.data_quality.provider.${item.key}`, item.key))}</span><strong>${esc(value)}</strong></article>`;
        }).join('')}
      </div>
      ${(quality.warnings || []).length ? `<p class="market-data-quality-warning">${esc(t('market.data_quality.warning'))}</p>` : ''}
    `;
    const hero = shell.querySelector('.market-command-hero');
    if (hero && hero.parentNode) hero.insertAdjacentElement('afterend', panel);
    else shell.prepend(panel);
  };

  const fallbackPayload = { data_quality: { coingecko: 'fallback', binance: 'fallback', futures: 'disabled', defillama: 'disabled', fear_greed: 'disabled', updated_at: '-' } };
  const loader = window.TimeblockMarketEnterprise && window.TimeblockMarketEnterprise.loadIntelligence;
  if (loader) {
    loader().then(render).catch(() => render(fallbackPayload));
    return;
  }
  const params = new URLSearchParams(window.location.search);
  const lang = params.get('lang') || locale;
  fetch(`/market/intelligence.json?lang=${encodeURIComponent(lang)}`, { headers: { Accept: 'application/json' } })
    .then((response) => response.ok ? response.json() : null)
    .then((payload) => payload && render(payload))
    .catch(() => render(fallbackPayload));
})();
