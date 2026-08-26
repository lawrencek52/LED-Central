const apiBaseUrl = import.meta.env.VITE_API_URL || 'http://localhost:3001/api'
const apiToken = import.meta.env.VITE_API_TOKEN || ''

async function request(path, options = {}) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(apiToken ? { Authorization: `Bearer ${apiToken}` } : {}),
      ...(options.headers || {}),
    },
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    const detailText = body.details ? `: ${Object.entries(body.details).map(([field, detail]) => `${field} ${detail}`).join(', ')}` : ''
    const error = new Error(`${body.error || `Request failed with status ${response.status}`}${detailText}`)
    error.details = body.details
    throw error
  }
  return body
}

export const apiClient = {
  getHealth: () => request('/health'),
  listControllers: () => request('/controllers'),
  createController: (controller) => request('/controllers', {
    method: 'POST',
    body: JSON.stringify(controller),
  }),
  updateController: (id, controller) => request(`/controllers/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(controller),
  }),
  connectController: (id) => request(`/controllers/${id}/connect`, { method: 'POST' }),
  disconnectController: (id) => request(`/controllers/${id}/disconnect`, { method: 'POST' }),
  deleteController: (id) => request(`/controllers/${id}`, { method: 'DELETE' }),
  listCanvases: () => request('/canvases'),
  createCanvas: (canvas) => request('/canvases', {
    method: 'POST',
    body: JSON.stringify(canvas),
  }),
  updateCanvas: (id, canvas, revision) => request(`/canvases/${id}`, {
    method: 'PUT',
    headers: revision ? { 'If-Match-Revision': String(revision) } : {},
    body: JSON.stringify(canvas),
  }),
  deleteCanvas: (id) => request(`/canvases/${id}`, { method: 'DELETE' }),
}
