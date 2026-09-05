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
            .map(([field, detail]) => `${field} ${detail}`)
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
};
