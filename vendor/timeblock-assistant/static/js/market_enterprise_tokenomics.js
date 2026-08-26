(() => {
  const shell = document.querySelector('.market-shell');
  if (!shell || shell.dataset.tokenomicsPhase4 === 'ready') return;
  shell.dataset.tokenomicsPhase4 = 'ready';

  const locale = document.documentElement.lang || 'vi';
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const makeT = (payload) => (key, fallback) => ((payload && payload.i18n && payload.i18n[key]) || fallback || key);
  const pct = (value) => value === null || value === undefined ? 'N/A' : `${(Number(value) * 100).toFixed(1)}%`;

  const card = (item, t) => {
    const risk = item.risk || 'not_rated';
    const flags = (item.flags || []).slice(0, 3).map((key) => `<span>${esc(t(key, key))}</span>`).join('');
    return `
      <article class="market-tokenomics-card tokenomics-${esc(risk)}">
        <div class="market-tokenomics-top">
          <span>${esc(item.symbol || '-')}</span>
          <strong>${esc(t(`market.tokenomics.risk.${risk}`, risk))}</strong>
        </div>
        <dl>
          <div><dt>${esc(t('market.tokenomics.fdv'))}</dt><dd>${esc(item.fdv_label || t('market.ui.price_unavailable'))}</dd></div>
          <div><dt>${esc(t('market.tokenomics.mc_fdv'))}</dt><dd>${esc(item.fdv_ratio_label || pct(item.fdv_ratio))}</dd></div>
          <div><dt>${esc(t('market.tokenomics.float'))}</dt><dd>${esc(item.circulating_ratio_label || pct(item.circulating_ratio))}</dd></div>
          <div><dt>${esc(t('market.tokenomics.volume_mc'))}</dt><dd>${esc(item.volume_to_market_cap_label || pct(item.volume_to_market_cap))}</dd></div>
        </dl>
        <div class="market-tokenomics-flags">${flags}</div>
      </article>
    `;
  };

  const render = (payload) => {
    const tokenomics = payload && payload.tokenomics;
    const t = makeT(payload);
    if (!tokenomics || shell.querySelector('.market-tokenomics-board')) return;
    const panel = document.createElement('section');
    panel.className = 'market-panel market-tokenomics-board market-collapsible';
    panel.setAttribute('aria-label', t('market.tokenomics.title'));
    const counts = tokenomics.risk_counts || {};
    panel.innerHTML = `
      <div class="market-panel-header">
        <div>
          <p class="eyebrow">${esc(t('market.tokenomics.eyebrow'))}</p>
          <h2>${esc(t('market.tokenomics.title'))}</h2>
        </div>
        <span class="market-note">${esc(t('market.tokenomics.note'))}</span>
      </div>
      <div class="market-tokenomics-counts">
        <span class="tokenomics-low">${esc(t('market.tokenomics.risk.low'))}: ${counts.low || 0}</span>
        <span class="tokenomics-medium">${esc(t('market.tokenomics.risk.medium'))}: ${counts.medium || 0}</span>
        <span class="tokenomics-high">${esc(t('market.tokenomics.risk.high'))}: ${counts.high || 0}</span>
        <span class="tokenomics-incomplete">${esc(t('market.tokenomics.risk.not_rated'))}: ${counts.not_rated || 0}</span>
      </div>
      <div class="market-tokenomics-grid">${(tokenomics.items || []).slice(0, 20).map((item) => card(item, t)).join('')}</div>
    `;
    const flow = shell.querySelector('.market-money-flow-map');
    if (flow && flow.parentNode) flow.insertAdjacentElement('afterend', panel);
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
