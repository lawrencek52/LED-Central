import { useEffect, useState } from "react";
import { apiClient } from "./api/client";

function EffectSelector({ canvases, effects, onError, lastEvent }) {
  const [canvasId, setCanvasId] = useState(canvases[0]?.id || "");
  const [effectId, setEffectId] = useState(effects[0]?.id || "");
  const [parameters, setParameters] = useState({});
  const [session, setSession] = useState(null);
  const [working, setWorking] = useState(false);
  const [fps, setFps] = useState(20);

  const effect = effects.find((item) => item.id === effectId);
  const runningSelectedEffect =
    session?.status === "playing" &&
    session.canvasId === canvasId &&
    session.effectId === effectId;

  useEffect(() => {
    if (!canvasId && canvases[0]) setCanvasId(canvases[0].id);
  }, [canvasId, canvases]);

  useEffect(() => {
    if (!effectId && effects[0]) setEffectId(effects[0].id);
    if (effectId && !effects.some((item) => item.id === effectId))
      setEffectId(effects[0]?.id || "");
  }, [effectId, effects]);

  useEffect(() => {
    if (!effect) return;
    setParameters(
      Object.fromEntries(
        Object.entries(effect.parameters || {}).map(([name, definition]) => [
          name,
          definition.default ?? "",
        ]),
      ),
    );
  }, [effect]);

  async function startPlayback() {
    if (!canvasId || !effectId) {
      onError("Choose a canvas and effect before starting playback.");
      return;
    }
    setWorking(true);
    onError("");
    try {
      const started = await apiClient.startPlayback({
        canvasId,
        effectId,
        parameters,
        fps,
      });
      setSession(started);
    } catch (requestError) {
      onError(requestError.message);
    } finally {
      setWorking(false);
    }
  }

  async function stopPlayback() {
    if (!session) return;
    setWorking(true);
    try {
      const stopped = await apiClient.stopPlayback(session.id);
      setSession(stopped);
    } catch (requestError) {
      onError(requestError.message);
    } finally {
      setWorking(false);
    }
  }

  function updateParameter(name, value, definition) {
    setParameters({
      ...parameters,
      [name]: definition.type === "number" ? Number(value) : value,
    });
  }

  return (
    <section className="effect-workspace">
      <div className="effect-toolbar">
        <label>
          Canvas
          <select
            value={canvasId}
            onChange={(event) => setCanvasId(event.target.value)}
            disabled={canvases.length === 0}
          >
            <option value="">Choose a canvas</option>
            {canvases.map((canvas) => (
              <option key={canvas.id} value={canvas.id}>
                {canvas.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Effect
          <select
            value={effectId}
            onChange={(event) => setEffectId(event.target.value)}
            disabled={effects.length === 0}
          >
            <option value="">Choose an effect</option>
            {effects.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <div
          className={`playback-state ${session?.status === "playing" ? "playing" : ""}`}
        >
          <i />
          {session?.status === "playing" ? "Playing" : "Ready"}
        </div>
      </div>

      <div className="effect-grid">
        <div className="effect-library panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Effect library</p>
              <h2>Choose a pattern</h2>
            </div>
            <span className="count-badge">{effects.length} available</span>
          </div>
          <div className="effect-list">
            {effects.map((item) => (
              <button
                className={`effect-card ${item.id === effectId ? "selected" : ""}`}
                type="button"
                key={item.id}
                onClick={() => setEffectId(item.id)}
              >
                <span className="effect-swatch" data-effect={item.renderer} />
                <span>
                  <strong>{item.name}</strong>
                  <small>{item.description}</small>
                </span>
                <b>{item.tags?.join(" / ")}</b>
              </button>
            ))}
          </div>
          {effects.length === 0 && (
            <div className="empty-state">No effects available.</div>
          )}
        </div>

        <div className="effect-config panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Pattern controls</p>
              <h2>{effect?.name || "Select an effect"}</h2>
            </div>
            {effect && (
              <span className="renderer-label">{effect.renderer}</span>
            )}
          </div>
          {effect ? (
            <div className="parameter-form">
              {Object.entries(effect.parameters || {}).map(
                ([name, definition]) => (
                  <label key={name}>
                    {name
                      .replace(/[A-Z]/g, (letter) => ` ${letter}`)
                      .toUpperCase()}{" "}
                    {definition.type === "color" ? (
                      <span className="color-control">
                        <input
                          type="color"
                          value={parameters[name] || "#ffffff"}
                          onChange={(event) =>
                            updateParameter(
                              name,
                              event.target.value,
                              definition,
                            )
                          }
                        />
                        <input
                          type="text"
                          value={parameters[name] || ""}
                          onChange={(event) =>
                            updateParameter(
                              name,
                              event.target.value,
                              definition,
                            )
                          }
                        />
                      </span>
                    ) : (
                      <span className="number-control">
                        <input
                          type="range"
                          min={definition.min ?? 0}
                          max={definition.max ?? 100}
                          step="any"
                          value={parameters[name] ?? definition.default ?? 0}
                          onChange={(event) =>
                            updateParameter(
                              name,
                              event.target.value,
                              definition,
                            )
                          }
                        />
                        <output>
                          {parameters[name] ?? definition.default}
                        </output>
                      </span>
                    )}
                  </label>
                ),
              )}
              <label className="fps-control">
                FRAMES PER SECOND{" "}
                <span className="number-control">
                  <input
                    type="range"
                    min="1"
                    max="60"
                    step="1"
                    value={fps}
                    onChange={(event) => setFps(Number(event.target.value))}
                  />
                  <output>{fps}</output>
                </span>
              </label>
              <div className="playback-actions">
                <button
                  className={`primary-button ${runningSelectedEffect ? "is-inactive" : ""}`}
                  type="button"
                  onClick={startPlayback}
                  disabled={working || !canvasId}
                >
                  {working ? "Starting..." : "Run on canvas"}
                </button>
                {session?.status === "playing" && (
                  <button
                    className={`secondary-button ${runningSelectedEffect ? "is-active" : "is-inactive"}`}
                    type="button"
                    onClick={stopPlayback}
                    disabled={working}
                  >
                    Stop
                  </button>
                )}
              </div>
              <p className="form-note">
                Frames render against the selected canvas and distribute to its
                mapped strips.
              </p>
            </div>
          ) : (
            <div className="empty-state">
              <strong>Select an effect</strong>
              <span>Choose a pattern to configure its controls.</span>
            </div>
          )}
        </div>
      </div>
      {lastEvent && (
        <div className="realtime-note">
          Last realtime event: <strong>{lastEvent}</strong>
        </div>
      )}
    </section>
  );
}

export default EffectSelector;
