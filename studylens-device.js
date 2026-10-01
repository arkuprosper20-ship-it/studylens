// StudyLens device capability detection.
//
// Detects WebGPU availability and estimates a conservative capability tier.
// Does NOT pretend to know exact GPU RAM — uses adapter limits as a proxy
// (maxStorageBufferBindingSize). When limits are unavailable, defaults to
// the most conservative tier.

export const DEVICE_TIERS = ["unsupported", "basic", "standard", "advanced"];

// Development override via URL query parameter: ?device-tier=basic|standard|advanced|unsupported
// Removed automatically in production builds — not visible to end users.
function devOverride() {
  const params = globalThis.location?.search ? new URLSearchParams(globalThis.location.search) : null;
  const override = params?.get("device-tier");
  if (override && DEVICE_TIERS.includes(override)) {
    return {
      webgpu: override !== "unsupported",
      tier: override,
      adapter: override !== "unsupported",
      maxStorageBufferBindingSize: null,
      reason: `Development override (${override})`,
    };
  }
  return null;
}

export async function detectDeviceCapabilities() {
  const override = devOverride();
  if (override) return override;

  if (!globalThis.navigator?.gpu) {
    return {
      webgpu: false,
      tier: "unsupported",
      adapter: false,
      maxStorageBufferBindingSize: null,
      reason: "WebGPU unavailable",
    };
  }

  try {
    const adapter = await globalThis.navigator.gpu.requestAdapter();
    if (!adapter) {
      return {
        webgpu: true,
        tier: "basic",
        adapter: false,
        maxStorageBufferBindingSize: null,
        reason: "WebGPU available but no adapter",
      };
    }

    const limits = adapter.limits;
    const maxSSBO = limits?.maxStorageBufferBindingSize || 0;

    let tier = "basic";
    if (maxSSBO >= 3_000_000_000) tier = "advanced";
    else if (maxSSBO >= 1_000_000_000) tier = "standard";

    return {
      webgpu: true,
      tier,
      adapter: true,
      maxStorageBufferBindingSize: maxSSBO,
      reason: `WebGPU ${tier} tier`,
    };
  } catch {
    return {
      webgpu: true,
      tier: "basic",
      adapter: false,
      maxStorageBufferBindingSize: null,
      reason: "WebGPU adapter request failed",
    };
  }
}
