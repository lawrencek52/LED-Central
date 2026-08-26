export function normalizeCanvas(canvas) {
  return {
    ...canvas,
    mappings: canvas.mappings.map(mapping => ({
      ...mapping,
      layout: mapping.layout || 'series',
      x: mapping.x || 0,
      y: mapping.y || 0,
      width: mapping.width || canvas.width,
      height: mapping.height || 1,
      rotation: mapping.rotation || 0,
      reversed: Boolean(mapping.reversed)
    }))
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

function coordinatesFor(mapping) {
  const coordinates = [];
  for (let row = 0; row < mapping.height; row++) {
    const rowCoordinates = [];
    for (let column = 0; column < mapping.width; column++) {
      rowCoordinates.push(transformCoordinate(mapping, column, row));
    }
    if (mapping.layout === 'serpentine' && row % 2 === 1) {
      rowCoordinates.reverse();
    }
    coordinates.push(...rowCoordinates);
  }
  if (mapping.reversed) coordinates.reverse();
  return coordinates;
}

function transformCoordinate(mapping, column, row) {
  const rotation = ((mapping.rotation % 360) + 360) % 360;
  if (rotation === 90) return [mapping.x + mapping.height - 1 - row, mapping.y + column];
  if (rotation === 180) return [mapping.x + mapping.width - 1 - column, mapping.y + mapping.height - 1 - row];
  if (rotation === 270) return [mapping.x + row, mapping.y + mapping.width - 1 - column];
  return [mapping.x + column, mapping.y + row];
}
