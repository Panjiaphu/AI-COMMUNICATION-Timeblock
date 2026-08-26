(() => {
  const shell = document.querySelector('.market-shell');
  if (!shell || shell.dataset.sentimentPhase6 === 'ready') return;
  shell.dataset.sentimentPhase6 = 'ready';

  const locale = document.documentElement.lang || 'vi';
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const makeT = (payload) => (key, fallback) => ((payload && payload.i18n && payload.i18n[key]) || fallback || key);
  const hasScore = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
  const clampScore = (value) => hasScore(value) ? Math.max(0, Math.min(100, Number(value))) : null;
  const scoreText = (value, t) => hasScore(value) ? `${Math.round(Number(value))}/100` : t('market.ui.price_unavailable', 'N/A');
  const keyTail = (key, fallback) => String(key || fallback || '').split('.').pop();
  const regimeText = (value, t) => t(`market.sentiment.regime.${value}`, value || '-');
  const riskModeText = (value, t) => t(`market.sentiment.risk_mode.${value}`, value || '-');
  const crowdText = (key, classification, t) => t(`market.sentiment.crowd.${keyTail(key, '')}`, classification || '-');
  const actionText = (key, t) => t(key, key || '-');

  const render = (payload) => {
    const sentiment = payload && payload.sentiment;
    const t = makeT(payload);
    if (!sentiment || shell.querySelector('.market-sentiment-board')) return;
    const value = clampScore(sentiment.value);
    const score = clampScore(sentiment.macro_score ?? sentiment.score);
    const flow = clampScore(sentiment.sector_flow_score);
    const regime = sentiment.macro_regime || 'unavailable';
    const actions = (sentiment.action_keys || []).slice(0, 4).map((key) => `<span>${esc(actionText(key, t))}</span>`).join('');
    const method = sentiment.method_key ? t(sentiment.method_key) : t('market.ui.price_unavailable', 'N/A');
    const meterStyle = score === null ? '' : `style="--sentiment-score: ${score}%"`;
    const meterValue = score === null ? t('market.ui.price_unavailable', 'N/A') : Math.round(score);
    const panel = document.createElement('section');
    panel.className = `market-panel market-sentiment-board sentiment-${esc(regime)} market-collapsible`;
    panel.setAttribute('aria-label', t('market.sentiment.title'));
    panel.innerHTML = `
      <div class="market-panel-header">
        <div>
          <p class="eyebrow">${esc(t('market.sentiment.eyebrow'))}</p>
          <h2>${esc(t('market.sentiment.title'))}</h2>
        </div>
        <span class="market-note">${esc(t('market.sentiment.note'))}</span>
      </div>
      <div class="market-sentiment-grid">
        <article class="market-sentiment-hero">
          <div class="market-sentiment-meter${score === null ? ' is-unavailable' : ''}" ${meterStyle}>
            <span>${esc(meterValue)}</span>
          </div>
          <div>
            <span>${esc(t('market.ui.macro_score'))}</span>
            <strong>${esc(regimeText(regime, t))}</strong>
            <p>${esc(crowdText(sentiment.crowd_key, sentiment.classification, t))} · ${esc(method)}</p>
          </div>
        </article>
        <article><span>${esc(t('market.ui.fear_greed'))}</span><strong>${esc(scoreText(value, t))}</strong><small>${esc(sentiment.classification || t('market.ui.price_unavailable', 'N/A'))}</small></article>
        <article><span>${esc(t('market.ui.flow_score'))}</span><strong>${esc(scoreText(flow, t))}</strong><small>${esc(t('market.ui.money_flow_map'))}</small></article>
        <article><span>${esc(t('market.ui.risk_mode'))}</span><strong>${esc(riskModeText(sentiment.risk_mode || 'unavailable', t))}</strong><small>${esc(t('market.ui.market_regime'))}: ${esc(regimeText(regime, t))}</small></article>
      </div>
      <div class="market-sentiment-actions">
        <strong>${esc(t('market.ui.action_priority'))}</strong>
        <div>${actions}</div>
      </div>
      <div class="market-sentiment-footer">
        <span>${esc(t('market.ui.updated'))}: ${esc(sentiment.updated_at || '-')}</span>
        <span>${esc(t('market.ui.source'))}: ${esc(t('market.sentiment.attribution'))}</span>
      </div>
      ${sentiment.status !== 'live' ? `<p class="market-sentiment-warning">${esc(t('market.sentiment.warning.fallback'))}</p>` : ''}
    `;
    const macro = shell.querySelector('.market-macro-panel');
    if (macro && macro.parentNode) macro.insertAdjacentElement('afterend', panel);
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
