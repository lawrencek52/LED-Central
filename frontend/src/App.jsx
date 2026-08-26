import { useEffect, useState } from 'react'
import { apiClient } from './api/client'
import './App.css'

const emptyForm = { name: '', host: '', port: '49152' }

function App() {
  const [controllers, setControllers] = useState([])
  const [health, setHealth] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function loadDashboard() {
    try {
      const [healthResponse, controllerResponse] = await Promise.all([
        apiClient.getHealth(),
        apiClient.listControllers(),
      ])
      setHealth(healthResponse)
      setControllers(controllerResponse)
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadDashboard()
  }, [])

  async function handleSubmit(event) {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      await apiClient.createController({ ...form, port: Number(form.port) })
      setForm(emptyForm)
      await loadDashboard()
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id) {
    setError('')
    try {
      await apiClient.deleteController(id)
      setControllers((current) => current.filter((controller) => controller.id !== id))
    } catch (requestError) {
      setError(requestError.message)
    }
  }

  const onlineCount = controllers.filter((controller) => controller.connected).length
  const outputCount = controllers.reduce((total, controller) => total + (controller.strips || 0), 0)

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="LED-Central home">
          <span className="brand-mark" aria-hidden="true">LC</span>
          <span>LED-Central</span>
        </a>
        <div className="topbar-status">
          <span className={`status-dot ${health ? 'is-ready' : ''}`} aria-hidden="true" />
          <span>{health ? 'System online' : 'System unavailable'}</span>
          <button className="refresh-button" type="button" onClick={() => { setLoading(true); setError(''); loadDashboard() }} disabled={loading}>Refresh</button>
        </div>
      </header>

      <section className="page-heading">
        <div>
          <p className="eyebrow">Control room / live inventory</p>
          <h1>Controller dashboard</h1>
          <p className="heading-copy">Monitor the network and keep every light surface within reach.</p>
        </div>
        <p className="last-check">Last check<br /><strong>{health ? new Date(health.timestamp).toLocaleTimeString() : 'Waiting...'}</strong></p>
      </section>

      {error && <div className="alert" role="alert">{error}</div>}

      <section className="metrics" aria-label="Controller summary">
        <div className="metric-panel metric-primary"><span>Registered</span><strong>{controllers.length}</strong><small>controllers</small></div>
        <div className="metric-panel"><span>Online</span><strong>{onlineCount}</strong><small>active connections</small></div>
        <div className="metric-panel"><span>Outputs</span><strong>{outputCount}</strong><small>LED strips mapped</small></div>
      </section>

      <div className="content-grid">
        <section className="panel controller-panel">
          <div className="panel-header">
            <div><p className="eyebrow">Network inventory</p><h2>Controllers</h2></div>
            <span className="count-badge">{controllers.length} total</span>
          </div>
          {loading ? <div className="empty-state">Loading controller inventory...</div> : controllers.length === 0 ? (
            <div className="empty-state"><strong>No controllers registered</strong><span>Add a device to begin distributing effects.</span></div>
          ) : (
            <div className="controller-list">
              {controllers.map((controller) => (
                <article className="controller-row" key={controller.id}>
                  <div className="controller-icon" aria-hidden="true">{controller.name.slice(0, 1).toUpperCase()}</div>
                  <div className="controller-details"><h3>{controller.name}</h3><p>{controller.host}:{controller.port}</p></div>
                  <div className="controller-meta"><span className={`connection-state ${controller.connected ? 'online' : ''}`}><i />{controller.connected ? 'Online' : 'Offline'}</span><span>{controller.strips || 0} strips</span></div>
                  <button className="icon-action" type="button" onClick={() => handleDelete(controller.id)} aria-label={`Remove ${controller.name}`} title="Remove controller">Remove</button>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="panel add-panel">
          <div className="panel-header"><div><p className="eyebrow">Device setup</p><h2>Add controller</h2></div></div>
          <form onSubmit={handleSubmit}>
            <label>Display name<input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Deck lights" /></label>
            <label>Host name or address<input required value={form.host} onChange={(event) => setForm({ ...form, host: event.target.value })} placeholder="deck1.local" /></label>
            <label>TCP port<input required type="number" min="1" max="65535" value={form.port} onChange={(event) => setForm({ ...form, port: event.target.value })} /></label>
            <button className="primary-button" type="submit" disabled={saving}>{saving ? 'Registering...' : 'Register controller'}</button>
          </form>
          <p className="form-note">NightDriverStrip devices typically listen on TCP port 49152.</p>
        </section>
      </div>
    </main>
  )
}

export default App
