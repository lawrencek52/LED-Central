import { useEffect, useRef, useState } from "react";
import { apiClient } from "./api/client";

function Preview({ preview, reversed }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!preview?.pixels || !preview.width || !preview.height) return;
    const canvas = canvasRef.current;
    const context = canvas.getContext("2d");
    const bytes = Uint8Array.from(atob(preview.pixels), (character) =>
      character.charCodeAt(0),
    );
    const image = context.createImageData(preview.width, preview.height);
    for (let index = 0; index < preview.width * preview.height; index += 1) {
      image.data[index * 4] = bytes[index * 3] || 0;
      image.data[index * 4 + 1] = bytes[index * 3 + 1] || 0;
      image.data[index * 4 + 2] = bytes[index * 3 + 2] || 0;
      image.data[index * 4 + 3] = 255;
    }
    canvas.width = preview.width;
    canvas.height = preview.height;
    context.imageSmoothingEnabled = false;
    context.putImageData(image, 0, 0);
  }, [preview]);

  return preview?.pixels && preview.width && preview.height ? (
    <canvas
      className="status-preview"
      style={{ transform: reversed ? "scaleX(-1)" : "none" }}
      ref={canvasRef}
      aria-label="Controller frame preview"
    />
  ) : (
    <span className="status-preview-empty">Preview unavailable</span>
  );
}

function Status({ onError }) {
  const [status, setStatus] = useState({ canvases: [] });
  // Frame previews are opt-in per controller, mirroring the firmware's own
  // web UI (which only opens its preview socket while that panel is
  // visible) - the backend used to open one permanently for every
  // controller with an active canvas mapping the moment this view first
  // polled status, whether or not anyone was actually looking.
  const [previewEnabled, setPreviewEnabled] = useState(() => new Set());
  const previewEnabledRef = useRef(previewEnabled);
  useEffect(() => {
    previewEnabledRef.current = previewEnabled;
  }, [previewEnabled]);

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
      previewEnabledRef.current.forEach((controllerId) => {
        apiClient.stopControllerPreview(controllerId).catch(() => {});
      });
    };
  }, [onError]);

  function togglePreview(controllerId) {
    setPreviewEnabled((current) => {
      const next = new Set(current);
      if (next.has(controllerId)) {
        next.delete(controllerId);
        apiClient.stopControllerPreview(controllerId).catch(() => {});
      } else {
        next.add(controllerId);
        apiClient.startControllerPreview(controllerId).catch(() => {});
      }
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
        <span className="count-badge">Updates every second</span>
      </div>
      {status.canvases.length === 0 ? (
        <div className="empty-state">
          <strong>No canvases defined</strong>
          <span>Create a canvas to monitor its output.</span>
        </div>
      ) : (
        status.canvases.map((canvas) => (
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
            <div className="status-strip-list">
              {canvas.strips.map((strip) => {
                const previewOn = previewEnabled.has(strip.controllerId);
                return (
                  <div
                    className="status-strip"
                    key={`${strip.controllerId}-${strip.stripIndex}`}
                  >
                    <div>
                      <strong>{strip.controllerName}</strong>
                      <small>
                        {strip.address} / Strip {strip.stripIndex + 1}
                      </small>
                    </div>
                    <span>
                      <b>Recv {strip.recvFps} FPS</b>
                      <small>Draw {strip.drawFps} FPS</small>
                      <small>{strip.kibPerSecond} KiB/s</small>
                      <small>{strip.queuedFrames} queued</small>
                    </span>
                    <button
                      className="secondary-button preview-toggle"
                      type="button"
                      onClick={() => togglePreview(strip.controllerId)}
                    >
                      {previewOn ? "Disable preview" : "Enable preview"}
                    </button>
                    {previewOn ? (
                      <Preview preview={strip.preview} reversed={strip.reversed} />
                    ) : (
                      <span className="status-preview-empty">
                        Preview disabled
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))
      )}
    </section>
  );
}

export default Status;
