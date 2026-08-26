(() => {
  const shell = document.querySelector('.market-shell');
  if (!shell || shell.dataset.hotTrendPhase2 === 'ready') return;
  shell.dataset.hotTrendPhase2 = 'ready';

  const locale = document.documentElement.lang || 'vi';
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const makeT = (payload) => (key, fallback) => ((payload && payload.i18n && payload.i18n[key]) || fallback || key);
  const signClass = (value) => Number(value || 0) >= 0 ? 'positive' : 'negative';
  const formatChange = (value) => `${Number(value || 0).toFixed(2)}%`;

  const card = (item, t) => {
    const tvSymbol = item.tradingview_symbol || `BINANCE:${item.symbol || 'BTC'}USDT`;
    const url = item.tradingview_url || `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(tvSymbol)}`;
    const riskFlag = item.risk_flag || 'medium';
    return `
      <article class="market-hot-card market-risk-${esc(riskFlag)}" data-tv-symbol="${esc(tvSymbol)}">
        <div class="market-hot-card-top">
          <span>${esc(item.symbol || '-')}</span>
          <strong>${esc(item.price_label || t('market.ui.price_unavailable'))}</strong>
        </div>
        <div class="market-hot-metrics">
          <span class="${signClass(item.change_24h)}">24h ${formatChange(item.change_24h)}</span>
          <span class="${signClass(item.change_7d)}">7d ${formatChange(item.change_7d)}</span>
          <span>${esc(t('market.ui.volume_ratio'))} ${Number(item.volume_ratio || 0).toFixed(2)}x</span>
        </div>
        <p>${esc(t(item.reason_key, item.reason_key || '-'))}</p>
        <div class="market-hot-footer">
          <span class="market-hot-risk market-risk-${esc(riskFlag)}">${esc(t(`market.risk.flag.${riskFlag}`, riskFlag))}</span>
          <a href="${esc(url)}" target="_blank" rel="noopener">${esc(t('market.ui.open_chart'))}</a>
        </div>
      </article>
    `;
  };

  const lane = (title, items, t) => `
    <section class="market-hot-lane">
      <h3>${esc(title)}</h3>
      <div class="market-hot-card-stack">
        ${(items || []).slice(0, 6).map((item) => card(item, t)).join('')}
      </div>
    </section>
  `;

  const render = (payload) => {
    const hot = payload && payload.hot_trends;
    const t = makeT(payload);
    if (!hot || shell.querySelector('.market-hot-trend-board')) return;
    const panel = document.createElement('section');
    panel.className = 'market-panel market-hot-trend-board market-collapsible';
    panel.setAttribute('aria-label', t('market.hot.title'));
    panel.innerHTML = `
      <div class="market-panel-header">
        <div>
          <p class="eyebrow">${esc(t('market.hot.eyebrow'))}</p>
          <h2>${esc(t('market.hot.title'))}</h2>
        </div>
        <span class="market-note">${esc(t('market.hot.note'))}</span>
      </div>
      <div class="market-hot-grid">
        ${lane(t('market.hot.trending'), hot.trending_search, t)}
        ${lane(t('market.hot.gainers'), hot.top_gainers, t)}
        ${lane(t('market.hot.high_risk'), hot.high_risk_radar, t)}
      </div>
    `;
    const priority = shell.querySelector('.market-priority-board');
    if (priority && priority.parentNode) priority.insertAdjacentElement('afterend', panel);
    else shell.appendChild(panel);
  };

  const loader = window.TimeblockMarketEnterprise && window.TimeblockMarketEnterprise.loadIntelligence;
  if (loader) {
    loader().then(render).catch(() => {});
    return;
  }
  const params = new URLSearchParams(window.location.search);
  const lang = params.get('lang') || locale;
  fetch(`/market/intelligence.json?lang=${encodeURIComponent(lang)}`, { headers: { Accept: 'application/json' } })
    .then((response) => response.ok ? response.json() : null)
    .then((payload) => payload && render(payload))
    .catch(() => {});
})();
