import { useEffect, useRef, useState } from "react";
import { apiClient } from "./api/client";

// Composites every strip's own preview frame into one canvas-shaped image,
// each placed at its mapping's (x, y) offset - the inverse of how the
// backend split a canvas frame into per-controller pixel arrays in the
// first place (see domain/canvases/canvas.js). Replaces showing one small
// preview per strip with a single image matching what the canvas actually
// looks like.
function CanvasPreview({ width, height, strips }) {
  const canvasRef = useRef(null);
  const hasAnyFrame = strips.some((strip) => strip.preview?.pixels);

  useEffect(() => {
    if (!hasAnyFrame || !width || !height) return;
    const canvasEl = canvasRef.current;
    const context = canvasEl.getContext("2d");
    const image = context.createImageData(width, height);

    for (const strip of strips) {
      const preview = strip.preview;
      if (!preview?.pixels || !preview.width || !preview.height) continue;
      const bytes = Uint8Array.from(atob(preview.pixels), (character) =>
        character.charCodeAt(0),
      );
      for (let row = 0; row < preview.height; row += 1) {
        const destY = strip.y + row;
        if (destY < 0 || destY >= height) continue;
        for (let column = 0; column < preview.width; column += 1) {
          const destX = strip.x + column;
          if (destX < 0 || destX >= width) continue;
          const srcIndex = (row * preview.width + column) * 3;
          const destIndex = (destY * width + destX) * 4;
          image.data[destIndex] = bytes[srcIndex] || 0;
          image.data[destIndex + 1] = bytes[srcIndex + 1] || 0;
          image.data[destIndex + 2] = bytes[srcIndex + 2] || 0;
          image.data[destIndex + 3] = 255;
        }
      }
    }

    canvasEl.width = width;
    canvasEl.height = height;
    context.imageSmoothingEnabled = false;
    context.putImageData(image, 0, 0);
  }, [width, height, strips, hasAnyFrame]);

  return hasAnyFrame ? (
    <canvas
      className="status-preview"
      ref={canvasRef}
      aria-label="Canvas frame preview"
    />
  ) : (
    <span className="status-preview-empty">Preview unavailable</span>
  );
}

// One row per distinct controller (a canvas built from several strips off
// the same controller, e.g. all 4 channels of one board, only lists it
// once) rather than one row per strip.
function uniqueControllers(strips) {
  const seen = new Map();
  for (const strip of strips) {
    if (!seen.has(strip.controllerId)) {
      seen.set(strip.controllerId, {
        controllerId: strip.controllerId,
        controllerName: strip.controllerName,
        address: strip.address,
        wifiSignal: strip.wifiSignal,
      });
    }
  }
  return [...seen.values()];
}

function summarizeStat(strips, key) {
  const values = strips.map((strip) => Number(strip[key]) || 0);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const avg = values.reduce((total, value) => total + value, 0) / values.length;
  return { min, avg: Math.round(avg * 10) / 10, max };
}

function StatRange({ label, unit, stat }) {
  return (
    <span className="canvas-stat">
      <b>{label}</b>
      <small>
        {stat.min}/{stat.avg}/{stat.max} {unit}
      </small>
    </span>
  );
}

function Status({ onError }) {
  const [status, setStatus] = useState({ canvases: [] });
  // Frame previews are opt-in per canvas, mirroring the firmware's own web
  // UI (which only opens its preview socket while that panel is visible) -
  // the backend used to open one permanently for every controller with an
  // active canvas mapping the moment this view first polled status, whether
  // or not anyone was actually looking.
  const [previewEnabledCanvases, setPreviewEnabledCanvases] = useState(
    () => new Set(),
  );
  const startedControllersRef = useRef(new Set());

  useEffect(() => {
    let active = true;
    async function refresh() {
      try {
        const next = await apiClient.getStatus();
        if (active) setStatus(next);
      } catch (requestError) {
        if (active) onError(requestError.message);
      }
    }
    refresh();
    const timer = setInterval(refresh, 1000);
    return () => {
      active = false;
      clearInterval(timer);
      startedControllersRef.current.forEach((controllerId) => {
        apiClient.stopControllerPreview(controllerId).catch(() => {});
      });
      startedControllersRef.current = new Set();
    };
  }, [onError]);

  // Reconciles which controllers need a live preview connection against
  // which canvases are toggled on, so a controller shared by two enabled
  // canvases (e.g. split across multiple canvases by strip) stays started
  // until neither wants it anymore, rather than each canvas managing its
  // own reference-count.
  useEffect(() => {
    const desired = new Set();
    for (const canvas of status.canvases) {
      if (!previewEnabledCanvases.has(canvas.canvasId)) continue;
      for (const strip of canvas.strips) desired.add(strip.controllerId);
    }
    const started = startedControllersRef.current;
    for (const controllerId of desired) {
      if (!started.has(controllerId))
        apiClient.startControllerPreview(controllerId).catch(() => {});
    }
    for (const controllerId of started) {
      if (!desired.has(controllerId))
        apiClient.stopControllerPreview(controllerId).catch(() => {});
    }
    startedControllersRef.current = desired;
  }, [previewEnabledCanvases, status.canvases]);

  function toggleCanvasPreview(canvasId) {
    setPreviewEnabledCanvases((current) => {
      const next = new Set(current);
      if (next.has(canvasId)) next.delete(canvasId);
      else next.add(canvasId);
      return next;
    });
  }

  return (
    <section className="status-workspace">
      <div className="status-heading">
        <div>
          <p className="eyebrow">Live output</p>
          <h2>Playback status</h2>
        </div>
        <div className="status-heading-meta">
          {status.hostCpu?.length ? (
            <span className="host-cpu" title="Per-core CPU utilization of the LED-Central host">
              <b>CPU</b> {status.hostCpu.join("/")} %
            </span>
          ) : null}
          <span className="count-badge">Updates every second</span>
        </div>
      </div>
      {status.canvases.length === 0 ? (
        <div className="empty-state">
          <strong>No canvases defined</strong>
          <span>Create a canvas to monitor its output.</span>
        </div>
      ) : (
        status.canvases.map((canvas) => {
          const previewOn = previewEnabledCanvases.has(canvas.canvasId);
          return (
            <section className="status-canvas" key={canvas.canvasId}>
              <div className="status-canvas-header">
                <div>
                  <p className="eyebrow">Canvas</p>
                  <h3>{canvas.canvasName}</h3>
                </div>
                <div className="status-summary">
                  <span>{canvas.effectName}</span>
                  <strong>{canvas.framesPerSecond} FPS</strong>
                </div>
              </div>
              <div className="status-controller-list">
                {uniqueControllers(canvas.strips).map((controller) => (
                  <div
                    className="status-controller"
                    key={controller.controllerId}
                  >
                    <strong>{controller.controllerName}</strong>
                    <small>{controller.address}</small>
                    {controller.wifiSignal !== null &&
                    controller.wifiSignal !== undefined ? (
                      <small title="WiFi signal reported by the controller">
                        WiFi {controller.wifiSignal} dBm
                      </small>
                    ) : null}
                  </div>
                ))}
              </div>
              <div className="canvas-stats">
                <StatRange
                  label="Recv"
                  unit="FPS"
                  stat={summarizeStat(canvas.strips, "recvFps")}
                />
                <StatRange
                  label="Draw"
                  unit="FPS"
                  stat={summarizeStat(canvas.strips, "drawFps")}
                />
                <StatRange
                  label="Rate"
                  unit="KiB/s"
                  stat={summarizeStat(canvas.strips, "kibPerSecond")}
                />
                <StatRange
                  label="Queued"
                  unit="frames"
                  stat={summarizeStat(canvas.strips, "queuedFrames")}
                />
              </div>
              <button
                className="secondary-button preview-toggle"
                type="button"
                onClick={() => toggleCanvasPreview(canvas.canvasId)}
              >
                {previewOn ? "Disable preview" : "Enable preview"}
              </button>
              {previewOn ? (
                <CanvasPreview
                  width={canvas.width}
                  height={canvas.height}
                  strips={canvas.strips}
                />
              ) : (
                <span className="status-preview-empty">Preview disabled</span>
              )}
            </section>
          );
        })
      )}
    </section>
  );
}

export default Status;
