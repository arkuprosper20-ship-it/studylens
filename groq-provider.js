const STATUS_URL = "/api/groq?status=1";
const API_URL = "/api/groq";

async function readResponse(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || "Groq is unavailable.");
    error.code = payload.code || "groq_unavailable";
    throw error;
  }
  return payload;
}

export const groqProvider = {
  async getStatus({ fetchImpl = fetch } = {}) {
    const response = await fetchImpl(STATUS_URL, { cache: "no-store" });
    return readResponse(response);
  },

  async analyze(text, { fetchImpl = fetch, signal, token } = {}) {
    if (!token) throw Object.assign(new Error("Sign in to use Groq Cloud."), { code: "auth_required" });
    const response = await fetchImpl(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ operation: "analyze-text", text }),
      signal,
    });
    const payload = await readResponse(response);
    return { suggestion: payload.result, model: payload.model };
  },

  async extractImageText(imageDataUrl, { fetchImpl = fetch, signal, token } = {}) {
    if (!token) throw Object.assign(new Error("Sign in to use Groq Cloud."), { code: "auth_required" });
    const response = await fetchImpl(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ operation: "extract-image-text", imageDataUrl }),
      signal,
    });
    return readResponse(response);
  },
};
