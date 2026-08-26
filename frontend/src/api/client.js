const apiBaseUrl = import.meta.env.VITE_API_URL || 'http://localhost:3001/api'
const apiToken = import.meta.env.VITE_API_TOKEN || ''

async function request(path, options = {}) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(apiToken ? { Authorization: `Bearer ${apiToken}` } : {}),
      ...(options.headers || {}),
    },
    ...options,
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(body.error || `Request failed with status ${response.status}`)
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
}
