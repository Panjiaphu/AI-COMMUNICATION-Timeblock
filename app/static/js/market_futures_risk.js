(function () {
  "use strict";

  var DICTIONARY = {
    vi: {
      title: "Quản trị rủi ro Futures",
      note: "Ước tính quy mô vị thế, ký quỹ ban đầu, PnL, ROE và % tài sản trước khi vào lệnh.",
      positionConfig: "Cấu hình vị thế",
      priceRisk: "Giá và rủi ro",
      result: "Kết quả mô phỏng",
      side: "Chiều vị thế",
      long: "Long",
      short: "Short",
      marginMode: "Chế độ ký quỹ",
      cross: "Cross",
      isolated: "Isolated",
      assetMode: "Chế độ tài sản",
      single: "Tài sản đơn lẻ",
      multi: "Đa tài sản",
      leverage: "Đòn bẩy",
      sizingMode: "Cách tính khối lượng",
      byRisk: "Theo rủi ro",
      byMargin: "Theo ký quỹ",
      byQuantity: "Theo số lượng",
      walletBalance: "Vốn tài khoản",
      availableBalance: "Số dư khả dụng",
      riskPct: "Rủi ro mỗi setup %",
      entryPrice: "Giá vào",
      markPrice: "Giá hiện tại / Mark",
      stopLoss: "Stop Loss",
      takeProfit: "Take Profit",
      marginAmount: "Ký quỹ nhập tay",
      quantity: "Số lượng",
      positionSize: "Quy mô vị thế",
      notional: "Giá trị danh nghĩa",
      initialMargin: "Ký quỹ ban đầu",
      pnlTp: "PnL tại TP",
      lossSl: "Lỗ tại SL",
      roe: "ROE",
      accountPnlPct: "% tài sản đạt được",
      accountRiskPct: "% tài sản rủi ro",
      rr: "R:R",
      marginUsed: "Tỷ lệ dùng ký quỹ",
      availableAfter: "Khả dụng sau ký quỹ",
      waiting: "Nhập đủ entry, SL và TP để mô phỏng.",
      invalidLong: "Cấu hình giá không hợp lệ cho vị thế Long: SL phải dưới entry và TP phải trên entry.",
      invalidShort: "Cấu hình giá không hợp lệ cho vị thế Short: SL phải trên entry và TP phải dưới entry.",
      marginExceeds: "Ký quỹ ban đầu vượt quá số dư khả dụng.",
      marginHigh: "Tỷ lệ dùng ký quỹ cao, cần giảm khối lượng hoặc đòn bẩy.",
      highLeverage: "Đòn bẩy cao, biến động nhỏ cũng có thể gây thanh lý nhanh.",
      crossNote: "Cross dùng số dư khả dụng để hỗ trợ vị thế; rủi ro có thể lan sang tài khoản.",
      isolatedNote: "Isolated giới hạn rủi ro trong phần ký quỹ của vị thế.",
      multiNote: "Multi-Assets Mode chỉ là mô phỏng; chưa tính haircut/collateral phức tạp nếu không có dữ liệu sàn.",
      liqNote: "Giá thanh lý chính xác cần maintenance margin bracket của sàn.",
      disclaimer: "Công cụ chỉ phục vụ phân tích, không phải lệnh giao dịch hoặc cam kết lợi nhuận."
    },
    en: {
      title: "Futures Risk Calculator",
      note: "Estimate position size, initial margin, PnL, ROE and account impact before execution.",
      positionConfig: "Position configuration",
      priceRisk: "Price and risk",
      result: "Simulation result",
      side: "Side",
      long: "Long",
      short: "Short",
      marginMode: "Margin mode",
      cross: "Cross",
      isolated: "Isolated",
      assetMode: "Asset mode",
      single: "Single-Asset",
      multi: "Multi-Assets",
      leverage: "Leverage",
      sizingMode: "Sizing mode",
      byRisk: "By risk",
      byMargin: "By margin",
      byQuantity: "By quantity",
      walletBalance: "Wallet balance",
      availableBalance: "Available balance",
      riskPct: "Risk per setup %",
      entryPrice: "Entry price",
      markPrice: "Mark price",
      stopLoss: "Stop Loss",
      takeProfit: "Take Profit",
      marginAmount: "Manual margin",
      quantity: "Quantity",
      positionSize: "Position size",
      notional: "Notional value",
      initialMargin: "Initial margin",
      pnlTp: "PnL at TP",
      lossSl: "Loss at SL",
      roe: "ROE",
      accountPnlPct: "Account PnL %",
      accountRiskPct: "Account risk %",
      rr: "R:R",
      marginUsed: "Margin used",
      availableAfter: "Available after margin",
      waiting: "Enter entry, SL and TP to simulate.",
      invalidLong: "Invalid Long setup: SL must be below entry and TP must be above entry.",
      invalidShort: "Invalid Short setup: SL must be above entry and TP must be below entry.",
      marginExceeds: "Initial margin exceeds available balance.",
      marginHigh: "Margin usage is high; reduce size or leverage.",
      highLeverage: "High leverage; small price moves can trigger liquidation quickly.",
      crossNote: "Cross mode can use available balance to support the position; risk can spread to the account.",
      isolatedNote: "Isolated mode limits risk to the position margin.",
      multiNote: "Multi-Assets Mode is simulated; collateral haircuts are not calculated without exchange data.",
      liqNote: "Accurate liquidation price requires the exchange maintenance margin bracket.",
      disclaimer: "This tool is for analysis only, not a trade order or profit guarantee."
    },
    "zh-TW": {
      title: "合約風險計算器",
      note: "進場前估算倉位、初始保證金、PnL、ROE 與帳戶影響。",
      positionConfig: "倉位設定",
      priceRisk: "價格與風險",
      result: "模擬結果",
      side: "方向",
      long: "Long",
      short: "Short",
      marginMode: "保證金模式",
      cross: "Cross",
      isolated: "Isolated",
      assetMode: "資產模式",
      single: "單一資產",
      multi: "多資產",
      leverage: "槓桿",
      sizingMode: "倉位計算方式",
      byRisk: "依風險",
      byMargin: "依保證金",
      byQuantity: "依數量",
      walletBalance: "帳戶資金",
      availableBalance: "可用餘額",
      riskPct: "每筆風險 %",
      entryPrice: "進場價",
      markPrice: "標記價 / 現價",
      stopLoss: "停損",
      takeProfit: "停利",
      marginAmount: "手動保證金",
      quantity: "數量",
      positionSize: "倉位規模",
      notional: "名目價值",
      initialMargin: "初始保證金",
      pnlTp: "TP 預估 PnL",
      lossSl: "SL 預估虧損",
      roe: "ROE",
      accountPnlPct: "帳戶收益 %",
      accountRiskPct: "帳戶風險 %",
      rr: "R:R",
      marginUsed: "保證金使用率",
      availableAfter: "扣除保證金後可用",
      waiting: "請輸入進場價、停損與停利以進行模擬。",
      invalidLong: "Long 價格設定無效：SL 必須低於進場價，TP 必須高於進場價。",
      invalidShort: "Short 價格設定無效：SL 必須高於進場價，TP 必須低於進場價。",
      marginExceeds: "初始保證金超過可用餘額。",
      marginHigh: "保證金使用率偏高，需降低倉位或槓桿。",
      highLeverage: "高槓桿下，小幅波動也可能快速觸發清算。",
      crossNote: "Cross 模式可能使用可用餘額支撐倉位，風險可能擴散至帳戶。",
      isolatedNote: "Isolated 模式將風險限制在該倉位保證金內。",
      multiNote: "多資產模式為模擬；若無交易所資料，不計算抵押折扣。",
      liqNote: "精準清算價需要交易所維持保證金級距。",
      disclaimer: "本工具僅供分析，不是交易指令或獲利保證。"
    }
  };

  function currentLocale() {
    var lang = (document.documentElement.getAttribute("lang") || "").trim();
    var urlLang = new URLSearchParams(window.location.search).get("lang") || "";
    var raw = urlLang || lang || "vi";
    if (raw.toLowerCase().indexOf("zh") === 0) return "zh-TW";
    if (raw.toLowerCase().indexOf("en") === 0) return "en";
    return "vi";
  }

  var I18N = DICTIONARY[currentLocale()] || DICTIONARY.vi;

  function parseMoney(value) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    var raw = String(value || "").replace(/\u00a0/g, " ");
    var matches = raw.match(/-?\d[\d,]*(?:\.\d+)?/g);
    if (!matches || !matches.length) return 0;
    var nums = matches.map(function (part) {
      return Number(part.replace(/,/g, ""));
    }).filter(Number.isFinite);
    if (!nums.length) return 0;
    if (nums.length >= 2 && /\s[-–—]\s/.test(raw)) {
      return (nums[0] + nums[1]) / 2;
    }
    return nums[0];
  }

  function clamp(value, min, max) {
    var numeric = Number(value || 0);
    if (!Number.isFinite(numeric)) return min;
    return Math.min(max, Math.max(min, numeric));
  }

  function formatNumber(value, digits) {
    if (!Number.isFinite(value)) return "N/A";
    return value.toLocaleString(undefined, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    });
  }

  function formatMoney(value) {
    if (!Number.isFinite(value)) return "N/A";
    var sign = value < 0 ? "-" : "";
    return sign + "$" + formatNumber(Math.abs(value), 2);
  }

  function formatPercent(value) {
    if (!Number.isFinite(value)) return "N/A";
    var sign = value > 0 ? "+" : "";
    return sign + formatNumber(value, 2) + "%";
  }

  function formatQty(value) {
    if (!Number.isFinite(value)) return "N/A";
    return value.toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: value >= 1 ? 4 : 6
    });
  }

  function getPanelDefaults(form) {
    var panel = form.closest("[data-lab-panel]");
    var planValues = panel ? panel.querySelectorAll(".lab-plan-grid article strong") : [];
    var entry = parseMoney(form.getAttribute("data-risk-entry"));
    var stop = parseMoney(form.getAttribute("data-risk-stop"));
    var target = parseMoney(form.getAttribute("data-risk-target"));
    if (!entry && planValues[0]) entry = parseMoney(planValues[0].textContent);
    if (!stop && planValues[1]) stop = parseMoney(planValues[1].textContent);
    if (!target && planValues[2]) target = parseMoney(planValues[2].textContent);
    var symbol = panel ? panel.getAttribute("data-lab-panel") || "" : "";
    return {
      symbol: symbol || "ASSET",
      entry: entry,
      mark: entry,
      stop: stop,
      target: target
    };
  }

  function inferSide(entry, stop, target) {
    if (entry && stop > entry && target < entry) return "short";
    return "long";
  }

  function buildCalculator(form) {
    var defaults = getPanelDefaults(form);
    var side = inferSide(defaults.entry, defaults.stop, defaults.target);
    var wrapper = document.createElement("section");
    wrapper.className = "futures-risk-card";
    wrapper.setAttribute("data-futures-risk-card", "");
    wrapper.setAttribute("data-symbol", defaults.symbol);
    wrapper.innerHTML =
      '<div class="futures-risk-header">' +
        '<div><span>' + I18N.title + '</span><strong>' + I18N.note + '</strong></div>' +
        '<small>' + I18N.disclaimer + '</small>' +
      '</div>' +
      '<div class="futures-risk-grid">' +
        '<form class="futures-risk-form" data-futures-risk-form>' +
          '<section><h4>' + I18N.positionConfig + '</h4><div class="futures-risk-input-grid">' +
            selectField("side", I18N.side, [["long", I18N.long], ["short", I18N.short]], side) +
            selectField("margin_mode", I18N.marginMode, [["cross", I18N.cross], ["isolated", I18N.isolated]], "cross") +
            selectField("asset_mode", I18N.assetMode, [["single", I18N.single], ["multi", I18N.multi]], "single") +
            selectField("sizing_mode", I18N.sizingMode, [["risk", I18N.byRisk], ["margin", I18N.byMargin], ["quantity", I18N.byQuantity]], "risk") +
            leverageField() +
          '</div></section>' +
          '<section><h4>' + I18N.priceRisk + '</h4><div class="futures-risk-input-grid">' +
            inputField("wallet_balance", I18N.walletBalance, 10000, 0, 100, "number") +
            inputField("available_balance", I18N.availableBalance, 10000, 0, 100, "number") +
            inputField("risk_pct", I18N.riskPct, 1, 0.1, 0.1, "number") +
            inputField("entry_price", I18N.entryPrice, defaults.entry || "", 0, 0.01, "number") +
            inputField("mark_price", I18N.markPrice, defaults.mark || "", 0, 0.01, "number") +
            inputField("stop_loss", I18N.stopLoss, defaults.stop || "", 0, 0.01, "number") +
            inputField("take_profit", I18N.takeProfit, defaults.target || "", 0, 0.01, "number") +
            inputField("margin_amount", I18N.marginAmount, 100, 0, 10, "number") +
            inputField("quantity", I18N.quantity, "", 0, 0.0001, "number") +
          '</div></section>' +
        '</form>' +
        '<section class="futures-risk-results" aria-live="polite">' +
          '<h4>' + I18N.result + '</h4>' +
          '<div class="futures-risk-result-grid">' +
            resultCard("position_size", I18N.positionSize) +
            resultCard("notional", I18N.notional) +
            resultCard("initial_margin", I18N.initialMargin) +
            resultCard("pnl_tp", I18N.pnlTp) +
            resultCard("loss_sl", I18N.lossSl) +
            resultCard("roe", I18N.roe) +
            resultCard("account_pnl", I18N.accountPnlPct) +
            resultCard("account_risk", I18N.accountRiskPct) +
            resultCard("rr", I18N.rr) +
            resultCard("margin_used", I18N.marginUsed) +
            resultCard("available_after", I18N.availableAfter) +
          '</div>' +
          '<div class="futures-risk-messages" data-futures-messages></div>' +
        '</section>' +
      '</div>';
    form.replaceWith(wrapper);
    var futuresForm = wrapper.querySelector("[data-futures-risk-form]");
    syncLeverage(futuresForm);
    futuresForm.addEventListener("input", function (event) {
      if (event.target.name === "leverage_range") {
        futuresForm.elements.leverage.value = event.target.value;
      }
      if (event.target.name === "leverage") {
        futuresForm.elements.leverage_range.value = clamp(event.target.value, 1, 100);
      }
      render(wrapper);
    });
    futuresForm.addEventListener("change", function () { render(wrapper); });
    render(wrapper);
  }

  function selectField(name, label, options, selected) {
    return '<label>' + label + '<select name="' + name + '">' + options.map(function (item) {
      return '<option value="' + item[0] + '"' + (item[0] === selected ? ' selected' : '') + '>' + item[1] + '</option>';
    }).join("") + '</select></label>';
  }

  function inputField(name, label, value, min, step, type) {
    return '<label>' + label + '<input type="' + type + '" name="' + name + '" min="' + min + '" step="' + step + '" value="' + value + '"></label>';
  }

  function leverageField() {
    return '<label class="leverage-slider-row">' + I18N.leverage +
      '<div><input type="range" name="leverage_range" min="1" max="100" step="1" value="1">' +
      '<input type="number" name="leverage" min="1" max="100" step="1" value="1"><span>x</span></div></label>';
  }

  function resultCard(key, label) {
    return '<article class="futures-risk-result-card" data-result-card="' + key + '"><span>' + label + '</span><strong data-result="' + key + '">N/A</strong></article>';
  }

  function syncLeverage(form) {
    form.elements.leverage.value = clamp(form.elements.leverage.value, 1, 100);
    form.elements.leverage_range.value = form.elements.leverage.value;
  }

  function readParams(wrapper) {
    var form = wrapper.querySelector("[data-futures-risk-form]");
    syncLeverage(form);
    return {
      symbol: wrapper.getAttribute("data-symbol") || "ASSET",
      side: form.elements.side.value,
      marginMode: form.elements.margin_mode.value,
      assetMode: form.elements.asset_mode.value,
      sizingMode: form.elements.sizing_mode.value,
      leverage: clamp(form.elements.leverage.value, 1, 100),
      wallet: Number(form.elements.wallet_balance.value || 0),
      available: Number(form.elements.available_balance.value || 0),
      riskPct: Number(form.elements.risk_pct.value || 0),
      entry: Number(form.elements.entry_price.value || 0),
      mark: Number(form.elements.mark_price.value || 0),
      stop: Number(form.elements.stop_loss.value || 0),
      target: Number(form.elements.take_profit.value || 0),
      marginAmount: Number(form.elements.margin_amount.value || 0),
      quantityInput: Number(form.elements.quantity.value || 0)
    };
  }

  function validate(params) {
    var warnings = [];
    if (!params.wallet || !params.available || !params.entry || !params.stop || !params.target) {
      return { valid: false, warnings: [I18N.waiting] };
    }
    if (params.side === "long" && !(params.stop < params.entry && params.target > params.entry)) {
      return { valid: false, warnings: [I18N.invalidLong] };
    }
    if (params.side === "short" && !(params.stop > params.entry && params.target < params.entry)) {
      return { valid: false, warnings: [I18N.invalidShort] };
    }
    return { valid: true, warnings: warnings };
  }

  function calculate(params) {
    var checked = validate(params);
    if (!checked.valid) {
      return { valid: false, warnings: checked.warnings };
    }
    var stopDistance = Math.abs(params.entry - params.stop);
    var quantity;
    if (params.sizingMode === "margin") {
      quantity = params.entry ? (params.marginAmount * params.leverage) / params.entry : 0;
    } else if (params.sizingMode === "quantity") {
      quantity = params.quantityInput;
    } else {
      var riskAmount = params.wallet * params.riskPct / 100;
      quantity = stopDistance ? riskAmount / stopDistance : 0;
    }
    var notional = quantity * params.entry;
    var initialMargin = notional / params.leverage;
    var pnlTp = params.side === "long" ? (params.target - params.entry) * quantity : (params.entry - params.target) * quantity;
    var rawLoss = params.side === "long" ? (params.entry - params.stop) * quantity : (params.stop - params.entry) * quantity;
    var lossSl = -Math.abs(rawLoss);
    var roe = initialMargin ? pnlTp / initialMargin * 100 : 0;
    var accountPnl = params.wallet ? pnlTp / params.wallet * 100 : 0;
    var accountRisk = params.wallet ? lossSl / params.wallet * 100 : 0;
    var rr = rawLoss ? Math.abs(pnlTp) / Math.abs(rawLoss) : 0;
    var marginUsed = params.available ? initialMargin / params.available * 100 : 0;
    var availableAfter = params.available - initialMargin;
    var warnings = checked.warnings.slice();
    if (initialMargin > params.available) warnings.push(I18N.marginExceeds);
    if (marginUsed > 80) warnings.push(I18N.marginHigh);
    if (params.leverage > 50) warnings.push(I18N.highLeverage);
    warnings.push(params.marginMode === "cross" ? I18N.crossNote : I18N.isolatedNote);
    if (params.assetMode === "multi") warnings.push(I18N.multiNote);
    warnings.push(I18N.liqNote);
    return {
      valid: true,
      warnings: warnings,
      quantity: quantity,
      notional: notional,
      initialMargin: initialMargin,
      pnlTp: pnlTp,
      lossSl: lossSl,
      roe: roe,
      accountPnl: accountPnl,
      accountRisk: accountRisk,
      rr: rr,
      marginUsed: marginUsed,
      availableAfter: availableAfter
    };
  }

  function setResult(wrapper, key, value, tone) {
    var el = wrapper.querySelector('[data-result="' + key + '"]');
    var card = wrapper.querySelector('[data-result-card="' + key + '"]');
    if (!el) return;
    el.textContent = value;
    if (card) {
      card.classList.remove("positive", "negative", "warning");
      if (tone) card.classList.add(tone);
    }
  }

  function render(wrapper) {
    var params = readParams(wrapper);
    var result = calculate(params);
    var messages = wrapper.querySelector("[data-futures-messages]");
    if (!result.valid) {
      ["position_size", "notional", "initial_margin", "pnl_tp", "loss_sl", "roe", "account_pnl", "account_risk", "rr", "margin_used", "available_after"].forEach(function (key) {
        setResult(wrapper, key, "N/A");
      });
      messages.innerHTML = result.warnings.map(function (msg) { return '<p class="futures-risk-warning">' + msg + '</p>'; }).join("");
      return;
    }
    setResult(wrapper, "position_size", formatQty(result.quantity) + " " + params.symbol);
    setResult(wrapper, "notional", formatMoney(result.notional));
    setResult(wrapper, "initial_margin", formatMoney(result.initialMargin));
    setResult(wrapper, "pnl_tp", formatMoney(result.pnlTp) + " / " + formatPercent(result.accountPnl) + "", "positive");
    setResult(wrapper, "loss_sl", formatMoney(result.lossSl) + " / " + formatPercent(result.accountRisk) + "", "negative");
    setResult(wrapper, "roe", formatPercent(result.roe), result.roe >= 0 ? "positive" : "negative");
    setResult(wrapper, "account_pnl", formatPercent(result.accountPnl), result.accountPnl >= 0 ? "positive" : "negative");
    setResult(wrapper, "account_risk", formatPercent(result.accountRisk), "negative");
    setResult(wrapper, "rr", formatNumber(result.rr, 2), result.rr >= 1.5 ? "positive" : "warning");
    setResult(wrapper, "margin_used", formatPercent(result.marginUsed), result.marginUsed > 80 ? "negative" : "");
    setResult(wrapper, "available_after", formatMoney(result.availableAfter), result.availableAfter < 0 ? "negative" : "");
    messages.innerHTML = result.warnings.map(function (msg, index) {
      return '<p class="' + (index < 3 ? 'futures-risk-warning' : 'futures-risk-note') + '">' + msg + '</p>';
    }).join("");
  }

  function init() {
    document.querySelectorAll("form[data-risk-calculator]").forEach(function (form) {
      if (!form.closest("[data-futures-risk-card]")) buildCalculator(form);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
