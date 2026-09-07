import { useEffect, useState } from "react";
import { apiClient } from "./api/client";

const blankCanvas = {
  name: "New canvas",
  width: 215,
  height: 1,
  mode: "series",
  stripSpacingRatio: 1,
  mappings: [],
};

function CanvasBuilder({ controllers, canvases, onCanvasesChange, onError }) {
  const [selectedId, setSelectedId] = useState("new");
  const [draft, setDraft] = useState(blankCanvas);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (selectedId === "new") return;
    const canvas = canvases.find((item) => item.id === selectedId);
    if (canvas)
      setDraft({
        ...canvas,
        mode: canvas.mappings.some((mapping) => mapping.y > 0)
          ? "parallel"
          : "series",
      });
  }, [canvases, selectedId]);

  function selectCanvas(id) {
    setSelectedId(id);
    if (id === "new") setDraft(blankCanvas);
  }

  function addStrip() {
    const used = new Set(
      canvases
        .filter((canvas) => canvas.id !== selectedId)
        .flatMap((canvas) =>
          canvas.mappings.map(
            (mapping) => `${mapping.controllerId}:${mapping.stripIndex}`,
          ),
        ),
    );
    draft.mappings.forEach((mapping) =>
      used.add(`${mapping.controllerId}:${mapping.stripIndex}`),
    );
    const available = controllers
      .flatMap((controller) =>
        Array.from({ length: controller.strips || 0 }, (_, stripIndex) => ({
          controller,
          stripIndex,
        })),
      )
      .find(
        ({ controller, stripIndex }) =>
          !used.has(`${controller.id}:${stripIndex}`),
      );
    if (!available) {
      onError("All controller strips are already assigned to canvases.");
      return;
    }
    const { controller, stripIndex } = available;
    const ledCount = controller.ledCounts?.[stripIndex] || 215;
    const mapping = {
      controllerId: controller.id,
      stripIndex,
      layout: draft.mode,
      x:
        draft.mode === "parallel"
          ? 0
          : draft.mappings.reduce((total, item) => total + item.width, 0),
      y: draft.mode === "parallel" ? draft.mappings.length : 0,
      width: ledCount,
      height: 1,
      reversed: false,
    };
    setDraft({
      ...draft,
      mappings: [...draft.mappings, mapping],
      width:
        draft.mode === "series"
          ? mapping.x + ledCount
          : Math.max(draft.width, ledCount),
      height: draft.mode === "parallel" ? mapping.y + 1 : 1,
    });
  }

  function updateMapping(index, changes) {
    const mappings = draft.mappings.map((mapping, mappingIndex) =>
      mappingIndex === index ? { ...mapping, ...changes } : mapping,
    );
    setDraft({ ...draft, mappings });
  }

  async function saveCanvas(event) {
    event.preventDefault();
    if (draft.mappings.length === 0) {
      onError("Add at least one strip to the canvas before saving.");
      return;
    }
    setSaving(true);
    onError("");
    try {
      if (!String(draft.name || "").trim())
        throw new Error("Canvas name is required.");
      if (!Number.isInteger(Number(draft.width)) || Number(draft.width) < 1)
        throw new Error("Canvas width must be a positive integer.");
      if (!Number.isInteger(Number(draft.height)) || Number(draft.height) < 1)
        throw new Error("Canvas height must be a positive integer.");
      if (!(Number(draft.stripSpacingRatio) > 0))
        throw new Error("Strip spacing ratio must be a positive number.");
      const mappings = draft.mappings.map((mapping) => ({
        ...mapping,
        x: Number(mapping.x || 0),
        y: Number(mapping.y || 0),
        width: Number(mapping.width),
        height: Number(mapping.height || 1),
      }));
      const payload = {
        name: draft.name,
        width: Math.max(
          Number(draft.width),
          ...mappings.map((mapping) => mapping.x + mapping.width),
        ),
        height: Math.max(
          Number(draft.height),
          ...mappings.map((mapping) => mapping.y + mapping.height),
        ),
        stripSpacingRatio: Number(draft.stripSpacingRatio),
        mappings,
      };
      const saved =
        selectedId === "new"
          ? await apiClient.createCanvas(payload)
          : await apiClient.updateCanvas(selectedId, payload, draft.revision);
      onCanvasesChange(
        selectedId === "new"
          ? [...canvases, saved]
          : canvases.map((canvas) => (canvas.id === saved.id ? saved : canvas)),
      );
      setSelectedId(saved.id);
      setDraft({ ...saved, mode: draft.mode });
    } catch (requestError) {
      onError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  async function deleteCanvas() {
    if (selectedId === "new") return;
    try {
      await apiClient.deleteCanvas(selectedId);
      onCanvasesChange(canvases.filter((canvas) => canvas.id !== selectedId));
      selectCanvas("new");
    } catch (requestError) {
      onError(requestError.message);
    }
  }

  const maxWidth = Math.max(
    Number(draft.width) || 1,
    ...draft.mappings.map(
      (mapping) => (Number(mapping.x) || 0) + (Number(mapping.width) || 0),
    ),
    1,
  );

  return (
    <section className="canvas-workspace">
      <section className="canvas-inventory panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Canvas inventory</p>
            <h2>Canvases</h2>
          </div>
          <span className="count-badge">{canvases.length} total</span>
        </div>
        <div className="canvas-inventory-list">
          {canvases.map((canvas) => (
            <button
              className={`canvas-inventory-card ${selectedId === canvas.id ? "selected" : ""}`}
              type="button"
              key={canvas.id}
              onClick={() => selectCanvas(canvas.id)}
            >
              <div className="canvas-inventory-preview">
                {canvas.mappings.map((mapping, index) => (
                  <span
                    key={`${mapping.controllerId}-${mapping.stripIndex}-${index}`}
                    style={{
                      "--strip-start": `${((mapping.x || 0) / Math.max(canvas.width, 1)) * 100}%`,
                      "--strip-size": `${((mapping.width || canvas.width) / Math.max(canvas.width, 1)) * 100}%`,
                      "--strip-row": (mapping.y || 0) + 1,
                    }}
                  />
                ))}
              </div>
              <span>
                <strong>{canvas.name}</strong>
                <small>
                  {canvas.width} x {canvas.height} / {canvas.mappings.length}{" "}
                  strips
                </small>
              </span>
            </button>
          ))}
          {canvases.length === 0 && (
            <div className="empty-state">No canvases defined.</div>
          )}
          <button
            className="canvas-inventory-new"
            type="button"
            onClick={() => selectCanvas("new")}
          >
            + Add new canvas
          </button>
        </div>
      </section>
      <section className="canvas-editor-panel panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Canvas setup</p>
            <h2>{selectedId === "new" ? "Add a new canvas" : "Edit canvas"}</h2>
          </div>
        </div>
        <div className="canvas-toolbar">
          <label>
            Layout
            <select
              value={draft.mode}
              onChange={(event) =>
                setDraft({ ...draft, mode: event.target.value })
              }
            >
              <option value="series">Series / one row</option>
              <option value="parallel">Parallel / rows</option>
            </select>
          </label>
          {selectedId !== "new" && (
            <button
              className="secondary-button"
              type="button"
              onClick={deleteCanvas}
            >
              Delete canvas
            </button>
          )}
        </div>
        <form className="canvas-editor" onSubmit={saveCanvas}>
          <div className="canvas-settings">
            <label>
              Canvas name
              <input
                required
                value={draft.name}
                onChange={(event) =>
                  setDraft({ ...draft, name: event.target.value })
                }
              />
            </label>
            <label>
              Width
              <input
                type="number"
                min="1"
                max="10000"
                value={draft.width}
                onChange={(event) =>
                  setDraft({ ...draft, width: Number(event.target.value) })
                }
              />
            </label>
            <label>
              Height
              <input
                type="number"
                min="1"
                max="10000"
                value={draft.height}
                onChange={(event) =>
                  setDraft({ ...draft, height: Number(event.target.value) })
                }
              />
            </label>
            {draft.mode === "parallel" && (
              <label>
                Strip spacing ratio
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={draft.stripSpacingRatio ?? 1}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      stripSpacingRatio: event.target.value,
                    })
                  }
                  title="Strip-to-strip spacing divided by LED-to-LED spacing along a strip. 1 for a regular matrix; e.g. 24.38 for strips 40.64cm apart with 1.667cm LED pitch."
                />
              </label>
            )}
            <button
              className="secondary-button"
              type="button"
              onClick={addStrip}
              disabled={controllers.length === 0}
            >
              Add strip
            </button>
          </div>
          <div className="canvas-preview-panel">
            <div className="preview-heading">
              <div>
                <p className="eyebrow">Canvas preview</p>
                <h3>
                  {draft.mode === "series"
                    ? "Continuous strip run"
                    : "Offset parallel rows"}
                </h3>
              </div>
              <span>
                {draft.mappings.length} strips / {maxWidth} LEDs wide
              </span>
            </div>
            <div
              className={`canvas-preview ${draft.mode}`}
              style={{
                "--canvas-width": maxWidth,
                "--preview-rows": Math.max(
                  1,
                  ...draft.mappings.map(
                    (mapping) => Number(mapping.y || 0) + 1,
                  ),
                ),
              }}
            >
              {draft.mappings.map((mapping, index) => {
                const controller = controllers.find(
                  (item) => item.id === mapping.controllerId,
                );
                return (
                  <div
                    className="canvas-strip"
                    key={`${mapping.controllerId}-${mapping.stripIndex}-${index}`}
                    style={{
                      "--strip-start": `${(mapping.x / maxWidth) * 100}%`,
                      "--strip-size": `${(mapping.width / maxWidth) * 100}%`,
                      "--strip-row": mapping.y + 1,
                    }}
                  >
                    <span>
                      {controller?.name || mapping.controllerId} / strip{" "}
                      {mapping.stripIndex + 1}
                    </span>
                    <b>{mapping.width} LEDs</b>
                  </div>
                );
              })}
              {draft.mappings.length === 0 && (
                <div className="canvas-empty">
                  Add strips to see the canvas layout.
                </div>
              )}
            </div>
          </div>
          <div className="strip-mapping-list">
            {draft.mappings.map((mapping, index) => {
              const controller = controllers.find(
                (item) => item.id === mapping.controllerId,
              );
              const assignedElsewhere = new Set(
                canvases
                  .filter((canvas) => canvas.id !== selectedId)
                  .flatMap((canvas) =>
                    canvas.mappings.map(
                      (item) => `${item.controllerId}:${item.stripIndex}`,
                    ),
                  ),
              );
              const assignedInDraft = new Set(
                draft.mappings.map(
                  (item) => `${item.controllerId}:${item.stripIndex}`,
                ),
              );
              return (
                <div
                  className="strip-mapping"
                  key={`${mapping.controllerId}-${mapping.stripIndex}-${index}`}
                >
                  <strong>Strip {index + 1}</strong>
                  <select
                    value={mapping.controllerId}
                    onChange={(event) =>
                      updateMapping(index, { controllerId: event.target.value })
                    }
                  >
                    {controllers.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                  <select
                    value={mapping.stripIndex}
                    onChange={(event) =>
                      updateMapping(index, {
                        stripIndex: Number(event.target.value),
                        width:
                          controller?.ledCounts?.[Number(event.target.value)] ||
                          215,
                      })
                    }
                  >
                    {Array.from(
                      { length: controller?.strips || 0 },
                      (_, stripIndex) => {
                        const key = `${controller.id}:${stripIndex}`;
                        return (
                          <option
                            key={stripIndex}
                            value={stripIndex}
                            disabled={
                              stripIndex !== mapping.stripIndex &&
                              (assignedElsewhere.has(key) ||
                                assignedInDraft.has(key))
                            }
                          >
                            Strip {stripIndex + 1}
                            {assignedElsewhere.has(key) ? " (used)" : ""}
                          </option>
                        );
                      },
                    )}
                  </select>
                  <label>
                    LEDs
                    <input
                      type="number"
                      min="1"
                      max="4200"
                      value={mapping.width}
                      onChange={(event) =>
                        updateMapping(index, {
                          width: Number(event.target.value),
                        })
                      }
                    />
                  </label>
                  {draft.mode === "parallel" && (
                    <label>
                      Offset
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={String(mapping.x ?? "")}
                        onChange={(event) =>
                          updateMapping(index, { x: event.target.value })
                        }
                      />
                    </label>
                  )}
                  <label>
                    Direction
                    <select
                      value={mapping.reversed ? "rtl" : "ltr"}
                      onChange={(event) =>
                        updateMapping(index, {
                          reversed: event.target.value === "rtl",
                        })
                      }
                    >
                      <option value="ltr">Left to right</option>
                      <option value="rtl">Right to left</option>
                    </select>
                  </label>
                  <button
                    className="icon-action danger"
                    type="button"
                    onClick={() =>
                      setDraft({
                        ...draft,
                        mappings: draft.mappings.filter(
                          (_, mappingIndex) => mappingIndex !== index,
                        ),
                      })
                    }
                  >
                    Remove
                  </button>
                </div>
              );
            })}
          </div>
          <button className="primary-button" type="submit" disabled={saving}>
            {saving
              ? "Saving canvas..."
              : selectedId === "new"
                ? "Create canvas"
                : "Save canvas"}
          </button>
        </form>
      </section>
    </section>
  );
}

export default CanvasBuilder;
