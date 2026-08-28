(function installGroupRadioLifecycle(window) {
  "use strict";

  class GroupRadioResourceLedger {
    constructor(generation) {
      this.generation = String(generation || "").trim();
      this.resources = new Map();
      this.terminated = false;
    }

    register(kind, handle) {
      if (this.terminated || !kind || !handle) return false;
      if (!this.resources.has(kind)) this.resources.set(kind, new Set());
      this.resources.get(kind).add(String(handle));
      return true;
    }

    terminate() {
      this.terminated = true;
      for (const handles of this.resources.values()) handles.clear();
      return this.snapshot();
    }

    snapshot() {
      let total = 0;
      for (const handles of this.resources.values()) total += handles.size;
      return { generation: this.generation, terminated: this.terminated, resource_zero: total === 0, resource_count: total };
    }
  }

  window.GroupRadioResourceLedger = Object.freeze({ create: (generation) => new GroupRadioResourceLedger(generation) });
}(window));
