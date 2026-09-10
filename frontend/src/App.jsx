import { useEffect, useState } from "react";
import { apiClient } from "./api/client";
import { createRealtimeClient } from "./api/realtime";
import CanvasBuilder from "./CanvasBuilder";
import EffectSelector from "./EffectSelector";
import Status from "./Status";
import "./App.css";

const emptyForm = {
  name: "",
  host: "",
  port: "49152",
  strips: "4",
  ledCounts: ["215", "215", "215", "215"],
};

function App() {
  const [controllers, setControllers] = useState([]);
  const [health, setHealth] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [connectingId, setConnectingId] = useState(null);
  const [recheckingAudioId, setRecheckingAudioId] = useState(null);
  const [error, setError] = useState("");
  const [realtimeStatus, setRealtimeStatus] = useState("connecting");
  const [lastEvent, setLastEvent] = useState("");
  const [canvases, setCanvases] = useState([]);
  const [activeTab, setActiveTab] = useState("effects");
  const [effects, setEffects] = useState([]);

  async function loadDashboard() {
    try {
      const [
        healthResponse,
        controllerResponse,
        canvasResponse,
        effectResponse,
      ] = await Promise.all([
        apiClient.getHealth(),
        apiClient.listControllers(),
        apiClient.listCanvases(),
        apiClient.listEffects(),
      ]);
      setHealth(healthResponse);
      setControllers(controllerResponse);
      setCanvases(canvasResponse);
      setEffects(effectResponse);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDashboard();
    return createRealtimeClient({
      onStatus: setRealtimeStatus,
      onEvent: (event) => {
        setLastEvent(event.type || "");
        if (
          event.type === "controller.updated" ||
          event.type === "distribution.completed"
        )
          loadDashboard();
      },
      url: import.meta.env.VITE_WS_URL,
      token: import.meta.env.VITE_WS_TOKEN,
    });
  }, []);

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const payload = {
        ...form,
        port: Number(form.port),
        strips: Number(form.strips),
        ledCounts: form.ledCounts.map(Number),
      };
      if (editingId) await apiClient.updateController(editingId, payload);
      else await apiClient.createController(payload);
      setForm(emptyForm);
      setEditingId(null);
      await loadDashboard();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  function editController(controller) {
    const ledCounts = Array.from(
      { length: controller.strips || 4 },
      (_, index) => String(controller.ledCounts?.[index] || "215"),
    );
    setEditingId(controller.id);
    setForm({
      name: controller.name,
      host: controller.host,
      port: String(controller.port),
      strips: String(controller.strips),
      ledCounts,
    });
  }

  function changeStripCount(value) {
    const count = Math.max(1, Math.min(16, Number(value) || 1));
    setForm({
      ...form,
      strips: String(count),
      ledCounts: Array.from(
        { length: count },
        (_, index) => form.ledCounts[index] || "215",
      ),
    });
  }

  async function handleDelete(id) {
    setError("");
    try {
      await apiClient.deleteController(id);
      setControllers((current) =>
        current.filter((controller) => controller.id !== id),
      );
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function handleConnection(controller) {
    setConnectingId(controller.id);
    setError("");
    try {
      const updated = controller.connected
        ? await apiClient.disconnectController(controller.id)
        : await apiClient.connectController(controller.id);
      setControllers((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setConnectingId(null);
    }
  }

  async function handleRecheckAudio(controller) {
    setRecheckingAudioId(controller.id);
    setError("");
    try {
      const updated = await apiClient.recheckControllerAudio(controller.id);
      setControllers((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setRecheckingAudioId(null);
    }
  }

  const onlineCount = controllers.filter(
    (controller) => controller.connected,
  ).length;
  const outputCount = controllers.reduce(
    (total, controller) => total + (controller.strips || 0),
    0,
  );
  const pageTitles = {
    effects: "Effect selection",
    status: "System status",
    canvases: "Canvas definition",
    controllers: "Controller dashboard",
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="LED-Central home">
          <span className="brand-mark" aria-hidden="true">
            LC
          </span>
          <span>LED-Central</span>
        </a>
        <div className="topbar-status">
          <span
            className={`status-dot ${realtimeStatus === "connected" ? "is-ready" : ""}`}
            aria-hidden="true"
          />
          <span>
            {realtimeStatus === "connected"
              ? "Realtime connected"
              : `Realtime ${realtimeStatus}`}
          </span>
          <button
            className="refresh-button"
            type="button"
            onClick={() => {
              setLoading(true);
              setError("");
              loadDashboard();
            }}
            disabled={loading}
          >
            Refresh
          </button>
        </div>
      </header>

      <section className="page-heading">
        <div>
          <p className="eyebrow">Control room / live inventory</p>
          <h1>{pageTitles[activeTab]}</h1>
          <p className="heading-copy">
            Monitor the network and keep every light surface within reach.
          </p>
        </div>
        <p className="last-check">
          Last check
          <br />
          <strong>
            {health
              ? new Date(health.timestamp).toLocaleTimeString()
              : "Waiting..."}
          </strong>
          {lastEvent && (
            <>
              <br />
              Event: <strong>{lastEvent}</strong>
            </>
          )}
        </p>
      </section>

      <nav className="dashboard-tabs" aria-label="Dashboard sections">
        <button
          className={activeTab === "effects" ? "active" : ""}
          type="button"
          onClick={() => setActiveTab("effects")}
        >
          Effects <span>{effects.length}</span>
        </button>
        <button
          className={activeTab === "status" ? "active" : ""}
          type="button"
          onClick={() => setActiveTab("status")}
        >
          Status
        </button>
        <button
          className={activeTab === "canvases" ? "active" : ""}
          type="button"
          onClick={() => setActiveTab("canvases")}
        >
          Canvases <span>{canvases.length}</span>
        </button>
        <button
          className={activeTab === "controllers" ? "active" : ""}
          type="button"
          onClick={() => setActiveTab("controllers")}
        >
          Controllers
        </button>
      </nav>

      {error && (
        <div className="alert" role="alert">
          {error}
        </div>
      )}

      {activeTab === "controllers" && (
        <section className="metrics" aria-label="Controller summary">
          <div className="metric-panel metric-primary">
            <span>Registered</span>
            <strong>{controllers.length}</strong>
            <small>controllers</small>
          </div>
          <div className="metric-panel">
            <span>Online</span>
            <strong>{onlineCount}</strong>
            <small>active connections</small>
          </div>
          <div className="metric-panel">
            <span>Outputs</span>
            <strong>{outputCount}</strong>
            <small>LED strips mapped</small>
          </div>
        </section>
      )}

      {activeTab === "controllers" && (
        <div className="content-grid">
          <section className="panel controller-panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Network inventory</p>
                <h2>Controllers</h2>
              </div>
              <span className="count-badge">{controllers.length} total</span>
            </div>
            {loading ? (
              <div className="empty-state">Loading controller inventory...</div>
            ) : controllers.length === 0 ? (
              <div className="empty-state">
                <strong>No controllers registered</strong>
                <span>Add a device to begin distributing effects.</span>
              </div>
            ) : (
              <div className="controller-list">
                {controllers.map((controller) => (
                  <article className="controller-row" key={controller.id}>
                    <div className="controller-icon" aria-hidden="true">
                      {controller.name.slice(0, 1).toUpperCase()}
                    </div>
                    <div className="controller-details">
                      <h3>{controller.name}</h3>
                      <p>
                        {controller.host}:{controller.port}
                      </p>
                    </div>
                    <div className="controller-meta">
                      <span
                        className={`connection-state ${controller.connected ? "online" : ""}`}
                      >
                        <i />
                        {controller.connected ? "Online" : "Offline"}
                      </span>
                      <span>{controller.strips || 0} strips</span>
                      <span>
                        {(controller.ledCounts || []).join(" / ") || "215"} LEDs
                      </span>
                      <span
                        className={`audio-state ${controller.audioAvailable === true ? "available" : ""}`}
                        title="Whether this controller currently advertises audio telemetry support"
                      >
                        <i />
                        Audio:{" "}
                        {controller.audioAvailable === true
                          ? "available"
                          : controller.audioAvailable === false
                            ? "unavailable"
                            : "unknown"}
                      </span>
                    </div>
                    <div className="row-actions">
                      <button
                        className="icon-action connect"
                        type="button"
                        onClick={() => handleConnection(controller)}
                        disabled={connectingId === controller.id}
                      >
                        {connectingId === controller.id
                          ? "Working..."
                          : controller.connected
                            ? "Disconnect"
                            : "Connect"}
                      </button>
                      <button
                        className="icon-action"
                        type="button"
                        onClick={() => handleRecheckAudio(controller)}
                        disabled={recheckingAudioId === controller.id}
                        title="Re-probe this controller for audio telemetry support - useful if it missed the check right after a reboot (e.g. an OTA update)"
                      >
                        {recheckingAudioId === controller.id
                          ? "Checking..."
                          : "Recheck Audio"}
                      </button>
                      <button
                        className="icon-action"
                        type="button"
                        onClick={() => editController(controller)}
                      >
                        Edit
                      </button>
                      <button
                        className="icon-action danger"
                        type="button"
                        onClick={() => handleDelete(controller.id)}
                        aria-label={`Remove ${controller.name}`}
                        title="Remove controller"
                      >
                        Remove
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="panel add-panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Device setup</p>
                <h2>{editingId ? "Edit controller" : "Add controller"}</h2>
              </div>
            </div>
            <form onSubmit={handleSubmit}>
              <label>
                Display name
                <input
                  required
                  value={form.name}
                  onChange={(event) =>
                    setForm({ ...form, name: event.target.value })
                  }
                  placeholder="Deck lights"
                />
              </label>
              <label>
                Host name or address
                <input
                  required
                  value={form.host}
                  onChange={(event) =>
                    setForm({ ...form, host: event.target.value })
                  }
                  placeholder="deck1.local"
                />
              </label>
              <label>
                TCP port
                <input
                  required
                  type="number"
                  min="1"
                  max="65535"
                  value={form.port}
                  onChange={(event) =>
                    setForm({ ...form, port: event.target.value })
                  }
                />
              </label>
              <label>
                Number of strips
                <input
                  required
                  type="number"
                  min="1"
                  max="16"
                  value={form.strips}
                  onChange={(event) => changeStripCount(event.target.value)}
                />
              </label>
              <fieldset className="strip-fields">
                <legend>LEDs per strip</legend>
                {form.ledCounts.map((count, index) => (
                  <label key={index}>
                    Strip {index + 1}
                    <input
                      required
                      type="number"
                      min="1"
                      max="65536"
                      value={count}
                      onChange={(event) => {
                        const ledCounts = [...form.ledCounts];
                        ledCounts[index] = event.target.value;
                        setForm({ ...form, ledCounts });
                      }}
                    />
                  </label>
                ))}
              </fieldset>
              <div className="form-actions">
                <button
                  className="primary-button"
                  type="submit"
                  disabled={saving}
                >
                  {saving
                    ? "Saving..."
                    : editingId
                      ? "Save controller"
                      : "Register controller"}
                </button>
                {editingId && (
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => {
                      setEditingId(null);
                      setForm(emptyForm);
                    }}
                  >
                    Cancel
                  </button>
                )}
              </div>
            </form>
            <p className="form-note">
              NightDriverStrip devices typically listen on TCP port 49152.
            </p>
          </section>
        </div>
      )}
      {activeTab === "canvases" && (
        <CanvasBuilder
          controllers={controllers}
          canvases={canvases}
          onCanvasesChange={setCanvases}
          onError={setError}
        />
      )}
      {activeTab === "effects" && (
        <EffectSelector
          canvases={canvases}
          effects={effects}
          onEffectsChange={setEffects}
          onError={setError}
          lastEvent={lastEvent}
        />
      )}
      {activeTab === "status" && <Status onError={setError} />}
    </main>
  );
}

export default App;
