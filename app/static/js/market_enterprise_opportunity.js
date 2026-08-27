(() => {
  const shell = document.querySelector('.market-shell');
  if (!shell || shell.dataset.opportunityPhase5 === 'ready') return;
  shell.dataset.opportunityPhase5 = 'ready';

  const locale = document.documentElement.lang || 'vi';
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const makeT = (payload) => (key, fallback) => ((payload && payload.i18n && payload.i18n[key]) || fallback || key);
  const riskKey = (value) => String(value || 'medium').replace('-', '_');

  const card = (item, t) => {
    const tvSymbol = item.tradingview_symbol || `BINANCE:${item.symbol || 'BTC'}USDT`;
    const url = item.tradingview_url || `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(tvSymbol)}`;
    const risk = riskKey(item.risk);
    const reasons = (item.reason_keys || []).map((key) => `<span>${esc(t(key, key))}</span>`).join('');
    return `
      <article class="market-opportunity-card opportunity-${esc(risk)}">
        <div class="market-opportunity-top">
          <span>${esc(item.symbol || '-')}</span>
          <strong>${esc(item.score || 0)}/100</strong>
        </div>
        <div class="market-opportunity-meter" style="--opportunity-score: ${Number(item.score || 0)}%"><span></span></div>
        <dl>
          <div><dt>${esc(t('market.opportunity.target'))}</dt><dd>${esc(item.target_7d || '-')}</dd></div>
          <div><dt>${esc(t('market.opportunity.entry'))}</dt><dd>${esc(item.entry || '-')}</dd></div>
          <div><dt>${esc(t('market.opportunity.setup'))}</dt><dd>${esc(t(item.setup_key, item.setup_key || '-'))}</dd></div>
          <div><dt>${esc(t('market.opportunity.horizon'))}</dt><dd>${esc(t(`market.horizon.${String(item.horizon || 'SWING').toLowerCase()}`, item.horizon || '-'))}</dd></div>
          <div><dt>${esc(t('market.opportunity.invalid_if'))}</dt><dd>${esc(t(item.invalid_if_key, item.invalid_if_key || '-'))}</dd></div>
        </dl>
        <div class="market-opportunity-reasons">${reasons}</div>
        <div class="market-opportunity-footer">
          <span>${esc(t(`market.opportunity.profile.${item.profile}`, item.profile || '-'))} · ${esc(t(`market.opportunity.risk.${risk}`, risk))}</span>
          <a href="${esc(url)}" target="_blank" rel="noopener">${esc(t('market.ui.open_chart'))}</a>
        </div>
      </article>
    `;
  };

  const render = (payload) => {
    const opportunities = payload && payload.opportunities;
    const t = makeT(payload);
    if (!opportunities || shell.querySelector('.market-opportunity-board')) return;
    const panel = document.createElement('section');
    panel.className = 'market-panel market-opportunity-board market-collapsible';
    panel.setAttribute('aria-label', t('market.opportunity.title'));
    panel.innerHTML = `
      <div class="market-panel-header">
        <div>
          <p class="eyebrow">${esc(t('market.opportunity.eyebrow'))}</p>
          <h2>${esc(t('market.opportunity.title'))}</h2>
        </div>
        <span class="market-note">${esc(t('market.opportunity.note'))}</span>
      </div>
      <div class="market-opportunity-grid">${(opportunities.items || []).slice(0, 12).map((item) => card(item, t)).join('')}</div>
    `;
    const tokenomics = shell.querySelector('.market-tokenomics-board');
    if (tokenomics && tokenomics.parentNode) tokenomics.insertAdjacentElement('afterend', panel);
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
