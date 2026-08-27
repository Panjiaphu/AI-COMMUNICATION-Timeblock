document.querySelectorAll(".points-adjust-form input[name='delta']").forEach((input) => {
  input.addEventListener("input", () => {
    input.dataset.direction = Number(input.value) >= 0 ? "increase" : "decrease";
  });
});

document.querySelectorAll(".mission-card").forEach((card) => {
  card.addEventListener("mouseenter", () => {
    card.classList.add("is-focused");
  });
  card.addEventListener("mouseleave", () => {
    card.classList.remove("is-focused");
  });
});

document.querySelectorAll(".ad-slot[data-network]").forEach((slot) => {
  const network = slot.dataset.network;
  slot.dataset.rendered = "pending";

  if (network === "adsense") {
    initializeAdsense(slot);
    return;
  }

  if (network === "mgid" || network === "ezoic" || network === "direct_sponsor") {
    slot.dataset.rendered = "true";
  }
});

function initializeAdsense(slot) {
  const adElement = slot.querySelector(".adsbygoogle");
  if (!adElement) {
    slot.dataset.rendered = "missing-element";
    return;
  }

  if (!window.adsbygoogle) {
    slot.dataset.rendered = "script-missing";
    return;
  }

  try {
    window.adsbygoogle.push({});
    slot.dataset.rendered = "true";
  } catch (error) {
    slot.dataset.rendered = "failed";
  }
}
