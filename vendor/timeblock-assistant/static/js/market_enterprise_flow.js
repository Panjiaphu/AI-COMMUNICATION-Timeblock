(() => {
  const shell = document.querySelector('.market-shell');
  if (!shell || shell.dataset.moneyFlowPhase3 === 'ready') return;
  shell.dataset.moneyFlowPhase3 = 'ready';

  const locale = document.documentElement.lang || 'vi';
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const makeT = (payload) => (key, fallback) => ((payload && payload.i18n && payload.i18n[key]) || fallback || key);

  const flagText = (key, t) => {
    if (String(key || '').endsWith('inflow')) return t('market.flow.flag.inflow');
    if (String(key || '').endsWith('outflow')) return t('market.flow.flag.outflow');
    if (key && String(key).startsWith('market.')) return t(key, key);
    return t('market.flow.flag.neutral');
  };

  const chainCard = (item, t) => `
    <article class="market-flow-chain-card flow-${esc(item.tone || 'neutral')}">
      <div class="market-flow-card-top">
        <span>${esc(item.name || '-')}</span>
        <strong>${Number(item.flow_score || 0)}/100</strong>
      </div>
      <div class="market-flow-meter" style="--flow-score: ${Number(item.flow_score || 0)}%"><span></span></div>
      <dl>
        <div><dt>${esc(t('market.ui.tvl_proxy'))}</dt><dd>${esc(item.tvl_label || t('market.ui.price_unavailable'))}</dd></div>
        <div><dt>${esc(t('market.ui.volume_24h'))}</dt><dd>${esc(item.dex_volume_24h_label || t('market.ui.price_unavailable'))}</dd></div>
      </dl>
      <small>${esc(flagText(item.flag_key, t))}</small>
    </article>
  `;

  const sectorCard = (item, t) => `
    <article class="market-flow-sector-card flow-${esc(item.tone || 'neutral')}">
      <div class="market-flow-card-top">
        <span>${esc(item.key || '-')}</span>
        <strong>${Number(item.flow_score || 0)}</strong>
      </div>
      <div class="market-flow-meter" style="--flow-score: ${Number(item.flow_score || 0)}%"><span></span></div>
      <p>${esc(t('market.ui.leaders'))}: ${esc((item.leaders || []).join(', ') || '-')}</p>
      <small>${esc(item.market_cap_label || t('market.ui.price_unavailable'))} · ${esc(item.volume_label || t('market.ui.price_unavailable'))}</small>
    </article>
  `;

  const render = (payload) => {
    const flow = payload && payload.money_flow;
    const t = makeT(payload);
    if (!flow || shell.querySelector('.market-money-flow-map')) return;
    const panel = document.createElement('section');
    panel.className = 'market-panel market-money-flow-map market-collapsible';
    panel.setAttribute('aria-label', t('market.flow.title'));
    panel.innerHTML = `
      <div class="market-panel-header">
        <div>
          <p class="eyebrow">${esc(t('market.flow.eyebrow'))}</p>
          <h2>${esc(t('market.flow.title'))}</h2>
        </div>
        <span class="market-note">${esc(t('market.flow.note'))}</span>
      </div>
      <div class="market-flow-layout">
        <section class="market-flow-block">
          <h3>${esc(t('market.flow.chain_title'))}</h3>
          <div class="market-flow-chain-grid">${(flow.chains || []).slice(0, 8).map((item) => chainCard(item, t)).join('')}</div>
        </section>
        <section class="market-flow-block">
          <h3>${esc(t('market.flow.sector_title'))}</h3>
          <div class="market-flow-sector-grid">${(flow.sectors || []).slice(0, 12).map((item) => sectorCard(item, t)).join('')}</div>
        </section>
      </div>
    `;
    const hot = shell.querySelector('.market-hot-trend-board');
    if (hot && hot.parentNode) hot.insertAdjacentElement('afterend', panel);
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
