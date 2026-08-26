export function normalizeCanvas(canvas) {
  return {
    ...canvas,
    mappings: canvas.mappings.map(mapping => ({
      ...mapping,
      rotation: mapping.rotation || 0,
      reversed: Boolean(mapping.reversed)
    }))
  };
}
