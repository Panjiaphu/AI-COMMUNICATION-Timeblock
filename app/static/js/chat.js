document.addEventListener("DOMContentLoaded", () => {
  const transcript = document.querySelector("[data-chat-transcript]");
  if (transcript) {
    transcript.scrollTop = transcript.scrollHeight;
  }

  const fileInput = document.querySelector("#chat-attachments");
  const fileSummary = document.querySelector("[data-file-summary]");
  if (!fileInput || !fileSummary) {
    return;
  }

  const defaultText = fileSummary.textContent;
  fileInput.addEventListener("change", () => {
    const count = fileInput.files.length;
    if (!count) {
      fileSummary.textContent = defaultText;
      return;
    }
    fileSummary.textContent = `${count} 個檔案已選取`;
  });
});
