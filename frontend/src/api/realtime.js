export function createRealtimeClient({ onEvent, onStatus, token = '', url = '' }) {
  const endpoint = url || `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.hostname}:3001/api/realtime`
  let socket
  let stopped = false
  let reconnectTimer
  let attempt = 0

  function connect() {
    if (stopped) return
    const authenticatedEndpoint = token ? `${endpoint}?token=${encodeURIComponent(token)}` : endpoint
    onStatus('connecting')
    socket = new WebSocket(authenticatedEndpoint)
    socket.addEventListener('open', () => {
      attempt = 0
      onStatus('connected')
      socket.send(JSON.stringify({ type: 'subscribe', topics: ['controllers', 'playback', 'distribution'] }))
    })
    socket.addEventListener('message', event => onEvent(JSON.parse(event.data)))
    socket.addEventListener('error', () => onStatus('error'))
    socket.addEventListener('close', () => {
      if (stopped) return
      onStatus('reconnecting')
      const delay = Math.min(1000 * 2 ** attempt, 10000)
      attempt += 1
      reconnectTimer = window.setTimeout(connect, delay)
    })
  }

  connect()
  return () => {
    stopped = true
    window.clearTimeout(reconnectTimer)
    socket?.close()
  }
}
