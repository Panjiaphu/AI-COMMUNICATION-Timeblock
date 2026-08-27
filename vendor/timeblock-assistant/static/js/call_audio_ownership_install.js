(() => {
  "use strict";
  const ownership = globalThis.TimeblockCallAudioOwnership;
  if (!ownership) return;
  ownership.installCallV1(globalThis.TimeblockCallV1);
  ownership.installAssistantEvents();
})();
