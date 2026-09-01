import { useEffect, useState } from "react";
import { apiClient } from "./api/client";

function EffectSelector({
  canvases,
  effects,
  onEffectsChange,
  onError,
  lastEvent,
}) {
  const [effectId, setEffectId] = useState(
    () =>
      window.localStorage.getItem("led-central.selectedEffect") ||
      effects[0]?.id ||
      "",
  );
  const [parameters, setParameters] = useState({});
  const [sessionsByCanvas, setSessionsByCanvas] = useState({});
  const [canvasEffectIds, setCanvasEffectIds] = useState({});
  const [working, setWorking] = useState(false);
  const [fps, setFps] = useState(20);
  const [friendlyName, setFriendlyName] = useState("");
  const [draggedEffectId, setDraggedEffectId] = useState(null);

  const effect = effects.find((item) => item.id === effectId);
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
    let active = true;
    apiClient
      .listPlayback()
      .then((sessions) => {
        if (!active) return;
        setSessionsByCanvas(
          Object.fromEntries(
            sessions
              .filter((session) => session.status === "playing")
              .map((session) => [session.canvasId, session]),
          ),
        );
        setCanvasEffectIds(
          Object.fromEntries(
            sessions
              .filter((session) => session.status === "playing")
              .map((session) => [session.canvasId, session.effectId]),
          ),
        );
      })
      .catch((requestError) => active && onError(requestError.message));
    return () => {
      active = false;
    };
  }, [onError]);

  useEffect(() => {
    if (!effectId && effects[0]) setEffectId(effects[0].id);
    if (effectId && !effects.some((item) => item.id === effectId))
      setEffectId(effects[0]?.id || "");
  }, [effectId, effects]);

  useEffect(() => {
    if (!effectId) return;
    setCanvasEffectIds((current) => {
      const next = { ...current };
      for (const canvas of canvases) {
        if (!sessionsByCanvas[canvas.id] && next[canvas.id] === undefined) {
          next[canvas.id] = effectId;
        }
      }
      return next;
    });
  }, [canvases, effectId, sessionsByCanvas]);

  function selectLibraryEffect(nextEffectId) {
    setEffectId(nextEffectId);
    setCanvasEffectIds((current) => {
      const next = { ...current };
      for (const canvas of canvases) {
        if (!sessionsByCanvas[canvas.id]) next[canvas.id] = nextEffectId;
      }
      return next;
    });
  }

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

  async function startPlayback(canvasId) {
    const selectedEffectId = canvasEffectIds[canvasId] ?? effects[0]?.id;
    if (!canvasId || !selectedEffectId) {
      onError("Choose an effect before starting playback.");
      return;
    }
    setWorking(true);
    onError("");
    try {
      const started = await apiClient.startPlayback({
        canvasId,
        effectId: selectedEffectId,
        parameters:
          selectedEffectId === effectId
            ? parameters
            : storedParameters(
                effects.find((item) => item.id === selectedEffectId),
              ),
        fps,
      });
      setSessionsByCanvas((current) => ({ ...current, [canvasId]: started }));
    } catch (requestError) {
      onError(requestError.message);
    } finally {
      setWorking(false);
    }
  }

  async function stopPlayback(canvasId) {
    const session = sessionsByCanvas[canvasId];
    if (!session) return;
    setWorking(true);
    try {
      await apiClient.stopPlayback(session.id);
      setSessionsByCanvas((current) => {
        const next = { ...current };
        delete next[canvasId];
        return next;
      });
      if (effectId) {
        setCanvasEffectIds((current) => ({
          ...current,
          [canvasId]: effectId,
        }));
      }
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
      <div className="canvas-playback-panel">
        <div className="canvas-playback-heading">
          <div>
            <p className="eyebrow">Canvas playback</p>
            <h2>Run effects</h2>
          </div>
          <span className="count-badge">{canvases.length} canvases</span>
        </div>
        <div className="canvas-playback-list">
          {canvases.map((canvas) => {
            const selectedEffectId = canvasEffectIds[canvas.id] ?? effects[0]?.id ?? "";
            const session = sessionsByCanvas[canvas.id];
            return (
              <div className="canvas-playback-row" key={canvas.id}>
                <strong>{canvas.name}</strong>
                <select
                  aria-label={`Effect for ${canvas.name}`}
                  value={selectedEffectId}
                  disabled={effects.length === 0 || working}
                  onChange={(event) => {
                    const nextEffectId = event.target.value;
                    setCanvasEffectIds((current) => ({
                      ...current,
                      [canvas.id]: nextEffectId,
                    }));
                    setEffectId(nextEffectId);
                  }}
                >
                  {effects.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => startPlayback(canvas.id)}
                  disabled={working || !selectedEffectId}
                >
                  {session?.status === "playing" ? "Restart" : "Start"}
                </button>
                <button
                  className={`secondary-button ${session?.status === "playing" ? "is-active" : ""}`}
                  type="button"
                  onClick={() => stopPlayback(canvas.id)}
                  disabled={working || !session || session.status !== "playing"}
                >
                  Stop
                </button>
              </div>
            );
          })}
        </div>
        {canvases.length === 0 && (
          <div className="empty-state">
            Create a canvas to assign an effect.
          </div>
        )}
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
                onClick={() => selectLibraryEffect(item.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    selectLibraryEffect(item.id);
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
                  className="secondary-button"
                  type="button"
                  onClick={resetParameters}
                  disabled={working}
                >
                  Reset defaults
                </button>
              </div>
              <p className="form-note">
                Select an effect here to edit its controls, then assign it to a
                canvas above.
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
