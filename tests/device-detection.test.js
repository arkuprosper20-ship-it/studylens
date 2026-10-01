import test from "node:test";
import assert from "node:assert/strict";
import { detectDeviceCapabilities, DEVICE_TIERS } from "../studylens-device.js";

function overrideGlobal(name, value) {
  const original = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  return () => original ? Object.defineProperty(globalThis, name, original) : delete globalThis[name];
}

test("detectDeviceCapabilities returns unsupported when WebGPU is unavailable", async () => {
  const restoreNavigator = overrideGlobal("navigator", {});
  try {
    const caps = await detectDeviceCapabilities();
    assert.equal(caps.webgpu, false);
    assert.equal(caps.tier, "unsupported");
    assert.equal(caps.adapter, false);
    assert.equal(caps.maxStorageBufferBindingSize, null);
  } finally {
    restoreNavigator();
  }
});

test("detectDeviceCapabilities returns basic tier with low adapter limits", async () => {
  const fakeAdapter = {
    limits: { maxStorageBufferBindingSize: 500_000_000 },
  };
  const restoreNavigator = overrideGlobal("navigator", {
    gpu: {
      requestAdapter: async () => fakeAdapter,
    },
  });
  const restoreLocation = overrideGlobal("location", { search: "" });
  try {
    const caps = await detectDeviceCapabilities();
    assert.equal(caps.webgpu, true);
    assert.equal(caps.tier, "basic");
    assert.equal(caps.adapter, true);
  } finally {
    restoreNavigator();
    restoreLocation();
  }
});

test("detectDeviceCapabilities returns standard tier with medium adapter limits", async () => {
  const fakeAdapter = {
    limits: { maxStorageBufferBindingSize: 1_500_000_000 },
  };
  const restoreNavigator = overrideGlobal("navigator", {
    gpu: {
      requestAdapter: async () => fakeAdapter,
    },
  });
  const restoreLocation = overrideGlobal("location", { search: "" });
  try {
    const caps = await detectDeviceCapabilities();
    assert.equal(caps.webgpu, true);
    assert.equal(caps.tier, "standard");
    assert.equal(caps.adapter, true);
  } finally {
    restoreNavigator();
    restoreLocation();
  }
});

test("detectDeviceCapabilities returns advanced tier with high adapter limits", async () => {
  const fakeAdapter = {
    limits: { maxStorageBufferBindingSize: 5_000_000_000 },
  };
  const restoreNavigator = overrideGlobal("navigator", {
    gpu: {
      requestAdapter: async () => fakeAdapter,
    },
  });
  const restoreLocation = overrideGlobal("location", { search: "" });
  try {
    const caps = await detectDeviceCapabilities();
    assert.equal(caps.webgpu, true);
    assert.equal(caps.tier, "advanced");
    assert.equal(caps.adapter, true);
  } finally {
    restoreNavigator();
    restoreLocation();
  }
});

test("detectDeviceCapabilities handles adapter request failure gracefully", async () => {
  const restoreNavigator = overrideGlobal("navigator", {
    gpu: {
      requestAdapter: async () => { throw new Error("Not allowed"); },
    },
  });
  const restoreLocation = overrideGlobal("location", { search: "" });
  try {
    const caps = await detectDeviceCapabilities();
    assert.equal(caps.webgpu, true);
    assert.equal(caps.tier, "basic");
    assert.equal(caps.adapter, false);
  } finally {
    restoreNavigator();
    restoreLocation();
  }
});

test("detectDeviceCapabilities supports development override via query parameter", async () => {
  const restoreNavigator = overrideGlobal("navigator", { gpu: { requestAdapter: async () => null } });
  const restoreLocation = overrideGlobal("location", { search: "?device-tier=unsupported" });
  try {
    const caps = await detectDeviceCapabilities();
    assert.equal(caps.webgpu, false);
    assert.equal(caps.tier, "unsupported");
    assert.equal(caps.adapter, false);
  } finally {
    restoreNavigator();
    restoreLocation();
  }
});

test("DEVICE_TIERS contains expected tiers", () => {
  assert.deepEqual(DEVICE_TIERS, ["unsupported", "basic", "standard", "advanced"]);
});
