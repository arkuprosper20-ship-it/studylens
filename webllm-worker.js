import { WebWorkerMLCEngineHandler } from "@mlc-ai/web-llm";

globalThis.addEventListener("securitypolicyviolation", (event) => {
	console.error("WebLLM worker CSP violation", event.effectiveDirective, event.blockedURI, event.originalPolicy);
});

const handler = new WebWorkerMLCEngineHandler();
self.onmessage = (message) => handler.onmessage(message);