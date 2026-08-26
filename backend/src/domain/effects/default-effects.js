export const defaultEffects = [
  {
    id: 'solid',
    name: 'Solid Color',
    description: 'Render one color across the selected canvas.',
    renderer: 'solid',
    parameters: {
      color: { type: 'color', default: '#ffffff' }
    },
    tags: ['basic', 'static']
  },
  {
    id: 'gradient',
    name: 'Gradient',
    description: 'Render a linear gradient across the selected canvas.',
    renderer: 'gradient',
    parameters: {
      startColor: { type: 'color', default: '#ff0000' },
      endColor: { type: 'color', default: '#0000ff' },
      angle: { type: 'number', min: 0, max: 360, default: 0 }
    },
    tags: ['color', 'static']
  },
  {
    id: 'wave',
    name: 'Wave',
    description: 'Animate a moving color wave across the selected canvas.',
    renderer: 'wave',
    parameters: {
      color: { type: 'color', default: '#00ccff' },
      speed: { type: 'number', min: 0, max: 10, default: 1 },
      width: { type: 'number', min: 1, max: 100, default: 25 }
    },
    tags: ['animated', 'motion']
  }
];
