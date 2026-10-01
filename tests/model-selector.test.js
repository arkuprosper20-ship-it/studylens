import test from "node:test";
import assert from "node:assert/strict";
import { getCompatibleModels, selectBestModel } from "../studylens-model-selector.js";
import { MODEL_REGISTRY } from "../studylens-model-registry.js";

const UNSUPPORTED = { webgpu: false, tier: "unsupported", adapter: false, maxStorageBufferBindingSize: null, reason: "WebGPU unavailable" };
const BASIC = { webgpu: true, tier: "basic", adapter: true, maxStorageBufferBindingSize: 500_000_000, reason: "WebGPU basic tier" };
const STANDARD = { webgpu: true, tier: "standard", adapter: true, maxStorageBufferBindingSize: 1_500_000_000, reason: "WebGPU standard tier" };
const ADVANCED = { webgpu: true, tier: "advanced", adapter: true, maxStorageBufferBindingSize: 5_000_000_000, reason: "WebGPU advanced tier" };

const SMALL_ID = "Qwen2.5-0.5B-Instruct-q4f32_1-MLC";
const MEDIUM_ID = "Qwen2.5-1.5B-Instruct-q4f16_1-MLC";
const LARGE_ID = "Qwen2.5-3B-Instruct-q4f16_1-MLC";

test("getCompatibleModels returns empty for unsupported devices", () => {
  assert.deepEqual(getCompatibleModels(UNSUPPORTED), []);
});

test("getCompatibleModels returns only small for basic tier", () => {
  const compatible = getCompatibleModels(BASIC);
  assert.equal(compatible.length, 1);
  assert.equal(compatible[0].id, SMALL_ID);
});

test("getCompatibleModels returns small and medium for standard tier", () => {
  const compatible = getCompatibleModels(STANDARD);
  assert.equal(compatible.length, 2);
  assert.equal(compatible[0].id, SMALL_ID);
  assert.equal(compatible[1].id, MEDIUM_ID);
});

test("getCompatibleModels returns all models for advanced tier", () => {
  const compatible = getCompatibleModels(ADVANCED);
  assert.equal(compatible.length, 3);
});

test("selectBestModel returns null for unsupported devices", () => {
  assert.equal(selectBestModel(UNSUPPORTED, { installed: [], preference: "automatic" }), null);
});

test("selectBestModel recommends the highest compatible tier even if not installed", () => {
  const model = selectBestModel(ADVANCED, { installed: [], preference: "automatic" });
  assert.equal(model.id, LARGE_ID);
});

test("selectBestModel prefers installed models", () => {
  const model = selectBestModel(ADVANCED, {
    installed: [SMALL_ID, MEDIUM_ID],
    preference: "automatic",
  });
  assert.equal(model.id, MEDIUM_ID);
});

test("selectBestModel respects user tier preference", () => {
  const model = selectBestModel(ADVANCED, {
    installed: [],
    preference: "small",
  });
  assert.equal(model.id, SMALL_ID);
});

test("selectBestModel falls back when user preference exceeds device capability", () => {
  const model = selectBestModel(BASIC, {
    installed: [],
    preference: "large",
  });
  assert.equal(model.id, SMALL_ID);
});

test("selectBestModel keeps the previous model if compatible and installed", () => {
  const model = selectBestModel(STANDARD, {
    installed: [SMALL_ID, MEDIUM_ID],
    preference: "automatic",
    previousModel: MEDIUM_ID,
  });
  assert.equal(model.id, MEDIUM_ID);
});

test("selectBestModel drops previous model if it is not compatible with the device", () => {
  const model = selectBestModel(BASIC, {
    installed: [SMALL_ID, LARGE_ID],
    preference: "automatic",
    previousModel: LARGE_ID,
  });
  assert.equal(model.id, SMALL_ID);
});

test("selectBestModel on standard device with no installs picks medium", () => {
  const model = selectBestModel(STANDARD, {
    installed: [],
    preference: "automatic",
  });
  assert.equal(model.id, MEDIUM_ID);
});
