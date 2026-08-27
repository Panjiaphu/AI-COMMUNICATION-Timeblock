document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".checkout-form").forEach((form) => {
    form.addEventListener("submit", () => {
      const button = form.querySelector("button[type='submit']");
      if (button) {
        button.textContent = "送出中";
      }
    });
  });

  document.querySelectorAll(".product-gallery").forEach((gallery) => {
    const mainImage = gallery.querySelector("[data-gallery-main]");
    const thumbs = gallery.querySelectorAll("[data-gallery-thumb]");
    if (!mainImage || !thumbs.length) {
      return;
    }

    thumbs.forEach((thumb) => {
      thumb.addEventListener("click", () => {
        const imageUrl = thumb.getAttribute("data-gallery-thumb");
        if (!imageUrl) {
          return;
        }
        mainImage.src = imageUrl;
        thumbs.forEach((item) => item.classList.remove("is-active"));
        thumb.classList.add("is-active");
      });
    });
  });
});
