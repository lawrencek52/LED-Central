import { useEffect, useState } from "react";
import { apiClient } from "./api/client";

function EffectSelector({
  canvases,
  effects,
  onEffectsChange,
  onError,
  lastEvent,
}) {
  const [canvasId, setCanvasId] = useState(
    () =>
      window.localStorage.getItem("led-central.selectedCanvas") ||
      canvases[0]?.id ||
      "",
  );
  const [effectId, setEffectId] = useState(
    () =>
      window.localStorage.getItem("led-central.selectedEffect") ||
      effects[0]?.id ||
      "",
  );
  const [parameters, setParameters] = useState({});
  const [session, setSession] = useState(null);
  const [working, setWorking] = useState(false);
  const [fps, setFps] = useState(20);
  const [friendlyName, setFriendlyName] = useState("");
  const [draggedEffectId, setDraggedEffectId] = useState(null);

  const effect = effects.find((item) => item.id === effectId);
  const runningSelectedEffect =
    session?.status === "playing" &&
    session.canvasId === canvasId &&
    session.effectId === effectId;

  function defaultParameters(currentEffect) {
    return Object.fromEntries(
      Object.entries(currentEffect?.parameters || {}).map(
        ([name, definition]) => [name, definition.default ?? ""],
      ),
    );
  }

  function storedParameters(currentEffect) {
    try {
      const stored = JSON.parse(
        window.localStorage.getItem(
          `led-central.parameters.${currentEffect.id}`,
        ) || "null",
      );
      return stored && typeof stored === "object"
        ? { ...defaultParameters(currentEffect), ...stored }
        : defaultParameters(currentEffect);
    } catch {
      return defaultParameters(currentEffect);
    }
  }

  useEffect(() => {
    if (!canvases.some((canvas) => canvas.id === canvasId) && canvases[0])
      setCanvasId(canvases[0].id);
  }, [canvasId, canvases]);

  useEffect(() => {
    if (canvasId)
      window.localStorage.setItem("led-central.selectedCanvas", canvasId);
  }, [canvasId]);

  useEffect(() => {
    if (!effectId && effects[0]) setEffectId(effects[0].id);
    if (effectId && !effects.some((item) => item.id === effectId))
      setEffectId(effects[0]?.id || "");
  }, [effectId, effects]);

  useEffect(() => {
    if (effectId)
      window.localStorage.setItem("led-central.selectedEffect", effectId);
  }, [effectId]);

  useEffect(() => {
    if (!effect) return;
    setParameters(storedParameters(effect));
    setFriendlyName(effect.name);
  }, [effect]);

  async function saveFriendlyName() {
    const name = friendlyName.trim();
    if (!effect || !name || name === effect.name) return;
    setWorking(true);
    onError("");
    try {
      const updated = await apiClient.updateEffect(effect.id, { name });
      onEffectsChange(
        effects.map((item) => (item.id === updated.id ? updated : item)),
      );
    } catch (requestError) {
      onError(requestError.message);
    } finally {
      setWorking(false);
    }
  }

  async function reorderEffects(targetEffectId) {
    if (!draggedEffectId || draggedEffectId === targetEffectId) return;
    const next = [...effects];
    const fromIndex = next.findIndex((item) => item.id === draggedEffectId);
    const targetIndex = next.findIndex((item) => item.id === targetEffectId);
    const [moved] = next.splice(fromIndex, 1);
    next.splice(targetIndex, 0, moved);
    const ordered = next.map((item, sortOrder) => ({ ...item, sortOrder }));
    onEffectsChange(ordered);
    setDraggedEffectId(null);
    onError("");
    try {
      await Promise.all(
        ordered.map(({ id, sortOrder }) =>
          apiClient.updateEffect(id, { sortOrder }),
        ),
      );
    } catch (requestError) {
      onEffectsChange(effects);
      onError(requestError.message);
    }
  }

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

  function formatNumericValue(value) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return String(value ?? "");
    return numericValue.toLocaleString(undefined, {
      maximumSignificantDigits: 3,
      maximumFractionDigits: 3,
    });
  }

  function updateParameter(name, value, definition) {
    const next = {
      ...parameters,
      [name]: definition.type === "number" ? Number(value) : value,
    };
    setParameters(next);
    window.localStorage.setItem(
      `led-central.parameters.${effect.id}`,
      JSON.stringify(next),
    );
  }

  function paletteColors(value, definition) {
    const source = value ?? definition.default;
    if (Array.isArray(source)) return source;
    if (Array.isArray(source?.colors)) return source.colors;
    return ["#ffffff"];
  }

  function updatePaletteColor(name, definition, index, colorValue) {
    const colors = [...paletteColors(parameters[name], definition)];
    colors[index] = colorValue;
    const current = parameters[name] ?? definition.default;
    const next = Array.isArray(current) ? colors : { ...current, colors };
    updateParameter(name, next, definition);
  }

  function resetParameters() {
    const defaults = defaultParameters(effect);
    setParameters(defaults);
    window.localStorage.setItem(
      `led-central.parameters.${effect.id}`,
      JSON.stringify(defaults),
    );
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
              <h2>Choose an effect</h2>
            </div>
            <span className="count-badge">{effects.length} available</span>
          </div>
          <div className="effect-list">
            {effects.map((item) => (
              <div
                className={`effect-card ${item.id === effectId ? "selected" : ""} ${item.id === draggedEffectId ? "dragging" : ""}`}
                key={item.id}
                role="button"
                tabIndex={0}
                onClick={() => setEffectId(item.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setEffectId(item.id);
                  }
                }}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => reorderEffects(item.id)}
              >
                <button
                  className="effect-reorder-handle"
                  type="button"
                  draggable
                  aria-label={`Reorder ${item.name}`}
                  title="Drag to reorder"
                  onClick={(event) => event.stopPropagation()}
                  onDragStart={(event) => {
                    event.stopPropagation();
                    event.dataTransfer.effectAllowed = "move";
                    setDraggedEffectId(item.id);
                  }}
                  onDragEnd={() => setDraggedEffectId(null)}
                >
                  &#9776;
                </button>
                <span className="effect-swatch" data-effect={item.renderer} />
                <span>
                  <strong>{item.name}</strong>
                  <small>{item.description}</small>
                </span>
                <b>{item.tags?.join(" / ")}</b>
              </div>
            ))}
          </div>
          {effects.length === 0 && (
            <div className="empty-state">No effects available.</div>
          )}
        </div>

        <div className="effect-config panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Effect controls</p>
              <h2>{effect?.name || "Select an effect"}</h2>
            </div>
            {effect && (
              <span className="renderer-label">{effect.renderer}</span>
            )}
          </div>
          {effect ? (
            <div className="parameter-form">
              <label className="friendly-name-control">
                FRIENDLY NAME
                <span>
                  <input
                    type="text"
                    value={friendlyName}
                    onChange={(event) => setFriendlyName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") saveFriendlyName();
                    }}
                  />
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={saveFriendlyName}
                    disabled={
                      working ||
                      !friendlyName.trim() ||
                      friendlyName.trim() === effect.name
                    }
                  >
                    Save
                  </button>
                </span>
              </label>
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
                    ) : definition.type === "palette" ? (
                      <span className="color-control">
                        {paletteColors(parameters[name], definition).map(
                          (colorValue, index) => (
                            <input
                              key={index}
                              type="color"
                              value={colorValue || "#ffffff"}
                              onChange={(event) =>
                                updatePaletteColor(
                                  name,
                                  definition,
                                  index,
                                  event.target.value,
                                )
                              }
                            />
                          ),
                        )}
                      </span>
                    ) : definition.type === "boolean" ? (
                      <input
                        type="checkbox"
                        checked={Boolean(
                          parameters[name] ?? definition.default,
                        )}
                        onChange={(event) =>
                          updateParameter(
                            name,
                            event.target.checked,
                            definition,
                          )
                        }
                      />
                    ) : definition.type === "string" ? (
                      <input
                        type="text"
                        value={parameters[name] ?? definition.default ?? ""}
                        onChange={(event) =>
                          updateParameter(name, event.target.value, definition)
                        }
                      />
                    ) : (
                      <span className="number-control">
                        <input
                          type="range"
                          min={definition.min ?? 0}
                          max={definition.max ?? 100}
                          step={
                            Number.isInteger(Number(definition.default ?? 0))
                              ? 1
                              : 0.01
                          }
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
                          {formatNumericValue(
                            parameters[name] ?? definition.default ?? 0,
                          )}
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
                <button
                  className="secondary-button"
                  type="button"
                  onClick={resetParameters}
                  disabled={working}
                >
                  Reset defaults
                </button>
              </div>
              <p className="form-note">
                Frames render against the selected canvas and distribute to its
                mapped strips.
              </p>
            </div>
          ) : (
            <div className="empty-state">
              <strong>Select an effect</strong>
              <span>Choose an effect to configure its controls.</span>
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
