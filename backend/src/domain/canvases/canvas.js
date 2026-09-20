export function normalizeCanvas(canvas) {
  return {
    ...canvas,
    // Ratio of strip-to-strip spacing to LED-to-LED spacing along one strip -
    // a fact about the physical wall this canvas represents (1:1 for a
    // regular matrix; e.g. ~24.38:1 for strips spaced far apart with densely
    // packed LEDs), used by effects that need real-world geometry to spread
    // something sideways across strips (e.g. rocket-fireworks).
    stripSpacingRatio:
      Number(canvas.stripSpacingRatio) > 0 ? Number(canvas.stripSpacingRatio) : 1,
    mappings: canvas.mappings.map(mapping => {
      const layout = mapping.layout || 'series';
      return {
        ...mapping,
        layout,
        x: mapping.x || 0,
        y: mapping.y || 0,
        width: mapping.width || canvas.width,
        height: mapping.height || 1,
        // Physical LED density (LEDs/meter), snapshotted from the controller at canvas-build
        // time (see CanvasBuilder.jsx) - null means unknown (older firmware, or a canvas built
        // before density detection existed), in which case density-aware effects (fire,
        // classic-fire) fall back to today's 1:1 cell-per-LED behavior unchanged.
        ledsPerMeter: Number(mapping.ledsPerMeter) > 0 ? Number(mapping.ledsPerMeter) : null,
        rotation: mapping.rotation || 0,
        reversed: Boolean(mapping.reversed),
        // Which corner of the mapping's rectangle physical LED 0 sits in,
        // and which axis the strip runs along before each serpentine turn -
        // only meaningful (and only stored) for layout 'serpentine', e.g. a
        // single strip wired as a matrix. Defaults reproduce the original
        // row-major top-left/horizontal serpentine behavior.
        ...(layout === 'serpentine'
          ? {
              originCorner: mapping.originCorner || 'top-left',
              axis: mapping.axis || 'horizontal'
            }
          : {})
      };
    })
  };
}

export function mapCanvasFrame(canvas, frame) {
  if (!frame || !Array.isArray(frame.pixels)) {
    throw new Error('Frame requires a pixel array');
  }
  if (frame.pixels.length !== canvas.width * canvas.height) {
    throw new Error(`Frame requires ${canvas.width * canvas.height} pixels`);
  }

  const mapped = new Map();
  for (const mapping of normalizeCanvas(canvas).mappings) {
    const pixels = coordinatesFor(mapping).map(([x, y]) => {
      if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) {
        throw new Error(`Canvas mapping is outside canvas bounds at ${x},${y}`);
      }
      return frame.pixels[y * canvas.width + x];
    });
    const target = mapped.get(mapping.controllerId) || [];
    target.push({
      ...frame,
      channelMask: 1 << mapping.stripIndex,
      pixels
    });
    mapped.set(mapping.controllerId, target);
  }
  return mapped;
}

// Inverse of mapCanvasFrame's own coordinatesFor(mapping).map(...) read-out:
// given a mapping's pixels already in physical LED wire order (as sent to
// the controller), rebuilds a plain row-major raster local to the mapping's
// own width x height rectangle - what a human expects to see, independent of
// wiring. Used for status/preview rendering, where a serpentine mapping's
// physical pixel order otherwise reads as a jumbled image (alternating rows
// shifted/mirrored) unless something first undoes the zigzag.
export function previewGridForMapping(mapping, pixels) {
  const grid = Array.from({ length: mapping.width * mapping.height }, () => [0, 0, 0]);
  coordinatesFor(mapping).forEach(([x, y], index) => {
    const localX = x - mapping.x;
    const localY = y - mapping.y;
    if (localX < 0 || localX >= mapping.width || localY < 0 || localY >= mapping.height) return;
    grid[localY * mapping.width + localX] = pixels[index] ?? [0, 0, 0];
  });
  return grid;
}

function coordinatesFor(mapping) {
  if (mapping.layout === 'serpentine') return serpentineCoordinates(mapping);

  const coordinates = [];
  for (let row = 0; row < mapping.height; row++) {
    for (let column = 0; column < mapping.width; column++) {
      coordinates.push(transformCoordinate(mapping, column, row));
    }
  }
  if (mapping.reversed) coordinates.reverse();
  return coordinates;
}

// Walks a single strip's physical LED order across a width x height
// rectangle, turning at the end of each run (boustrophedon/"serpentine"
// wiring) - the layout a matrix panel built from one strip actually uses.
// originCorner is where physical LED 0 sits; axis is the direction that
// first run travels. Unlike a whole-list reverse, each run's direction is
// decided from its own pass index, so all 4 corners x 2 axes stay distinct
// regardless of whether width/height is odd or even.
function serpentineCoordinates(mapping) {
  const { width, height, x, y, originCorner, axis } = mapping;
  const startsRight = originCorner.includes('right');
  const startsBottom = originCorner.includes('bottom');
  const coordinates = [];
  if (axis === 'vertical') {
    for (let pass = 0; pass < width; pass++) {
      const column = startsRight ? width - 1 - pass : pass;
      const rows = Array.from({ length: height }, (_, index) => index);
      const reverse = pass % 2 === 1 ? !startsBottom : startsBottom;
      if (reverse) rows.reverse();
      for (const row of rows) coordinates.push([x + column, y + row]);
    }
  } else {
    for (let pass = 0; pass < height; pass++) {
      const row = startsBottom ? height - 1 - pass : pass;
      const columns = Array.from({ length: width }, (_, index) => index);
      const reverse = pass % 2 === 1 ? !startsRight : startsRight;
      if (reverse) columns.reverse();
      for (const column of columns) coordinates.push([x + column, y + row]);
    }
  }
  return coordinates;
}

function transformCoordinate(mapping, column, row) {
  const rotation = ((mapping.rotation % 360) + 360) % 360;
  if (rotation === 90) return [mapping.x + mapping.height - 1 - row, mapping.y + column];
  if (rotation === 180) return [mapping.x + mapping.width - 1 - column, mapping.y + mapping.height - 1 - row];
  if (rotation === 270) return [mapping.x + row, mapping.y + mapping.width - 1 - column];
  return [mapping.x + column, mapping.y + row];
}
