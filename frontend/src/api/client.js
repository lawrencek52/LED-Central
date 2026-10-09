const browserHost =
  typeof window !== "undefined" ? window.location.hostname : "localhost";
const browserProtocol =
  typeof window !== "undefined" ? window.location.protocol : "http:";
const defaultApiBaseUrl = `${browserProtocol}//${browserHost}:3001/api`;
const configuredApiUrl = import.meta.env.VITE_API_URL;
const apiBaseUrl =
  configuredApiUrl &&
  !/^(https?:\/\/)?(localhost|127\.0\.0\.1)(:\d+)?\/?.*$/i.test(
    configuredApiUrl,
  )
    ? configuredApiUrl
    : defaultApiBaseUrl;
const apiToken = import.meta.env.VITE_API_TOKEN || "";

// error.details values aren't always plain strings (e.g. distribution errors
// carry {sent: [...], failed: [{controllerId, error}]} arrays of objects) -
// template-literal string interpolation on those silently produces
// "[object Object]" instead of anything useful. Format each shape by hand
// so the actual failure (which controller, what error) stays visible.
function formatDetail(detail) {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    if (detail.length === 0) return "none";
    return detail.map(formatDetail).join("; ");
  }
  if (detail && typeof detail === "object") {
    if ("controllerId" in detail)
      return `${detail.controllerId}${detail.error ? `: ${detail.error}` : ""}`;
    return JSON.stringify(detail);
  }
  return String(detail);
}

async function request(path, options = {}) {
  const url = `${apiBaseUrl}${path}`;

  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(apiToken ? { Authorization: `Bearer ${apiToken}` } : {}),
        ...(options.headers || {}),
      },
    });

    let body = {};
    try {
      body = await response.json();
    } catch {
      const text = await response.text().catch(() => "");
      if (text) {
        body = { error: text };
      }
    }

    if (!response.ok) {
      const detailText = body.details
        ? `: ${Object.entries(body.details)
            .map(([field, detail]) => `${field} ${formatDetail(detail)}`)
            .join(", ")}`
        : "";
      const reason = body.error || body.message || `HTTP ${response.status}`;
      const error = new Error(
        `Failed to fetch ${path} from ${url}: ${reason}${detailText}`,
      );
      error.details = body.details;
      throw error;
    }

    return body;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Failed to fetch")) {
      throw error;
    }

    throw new Error(
      `Failed to fetch ${path} from ${url}: ${error instanceof Error ? error.message : "network request failed"}`,
    );
  }
}

export const apiClient = {
  getHealth: () => request("/health"),
  listControllers: () => request("/controllers"),
  createController: (controller) =>
    request("/controllers", {
      method: "POST",
      body: JSON.stringify(controller),
    }),
  updateController: (id, controller) =>
    request(`/controllers/${id}`, {
      method: "PATCH",
      body: JSON.stringify(controller),
    }),
  connectController: (id) =>
    request(`/controllers/${id}/connect`, { method: "POST" }),
  disconnectController: (id) =>
    request(`/controllers/${id}/disconnect`, { method: "POST" }),
  recheckControllerAudio: (id) =>
    request(`/controllers/${id}/recheck-audio`, { method: "POST" }),
  deleteController: (id) => request(`/controllers/${id}`, { method: "DELETE" }),
  detectController: (host) =>
    request("/controllers/detect", {
      method: "POST",
      body: JSON.stringify({ host }),
    }),
  startControllerPreview: (id) =>
    request(`/controllers/${id}/preview/start`, { method: "POST" }),
  stopControllerPreview: (id) =>
    request(`/controllers/${id}/preview/stop`, { method: "POST" }),
  listCanvases: () => request("/canvases"),
  createCanvas: (canvas) =>
    request("/canvases", {
      method: "POST",
      body: JSON.stringify(canvas),
    }),
  updateCanvas: (id, canvas, revision) =>
    request(`/canvases/${id}`, {
      method: "PUT",
      headers: revision ? { "If-Match-Revision": String(revision) } : {},
      body: JSON.stringify(canvas),
    }),
  deleteCanvas: (id) => request(`/canvases/${id}`, { method: "DELETE" }),
  listEffects: () => request("/effects"),
  updateEffect: (id, effect) =>
    request(`/effects/${id}`, {
      method: "PATCH",
      body: JSON.stringify(effect),
    }),
  getStatus: () => request("/status"),
  listPlayback: () => request("/playback"),
  startPlayback: (playback) =>
    request("/playback/start", {
      method: "POST",
      body: JSON.stringify(playback),
    }),
  stopPlayback: (id) => request(`/playback/${id}/stop`, { method: "POST" }),
  testAlertSound: (canvasId, options) =>
    request(`/canvases/${canvasId}/alert-sound`, {
      method: "POST",
      body: JSON.stringify(options),
    }),
};
