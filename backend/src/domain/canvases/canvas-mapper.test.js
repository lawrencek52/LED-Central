import test from 'node:test';
import assert from 'node:assert/strict';
import { mapCanvasFrame } from './canvas.js';

const pixels = [
  ['a'], ['b'], ['c'], ['d'], ['e'], ['f'],
  ['g'], ['h'], ['i'], ['j'], ['k'], ['l']
];

function frameFor(pixelsToMap) {
  return { timestamp: 1000, pixels: pixelsToMap };
}

test('maps a series canvas into consecutive strips', () => {
  const mapped = mapCanvasFrame({
    width: 6, height: 1,
    mappings: [
      { controllerId: 'deck1', stripIndex: 0, x: 0, width: 3 },
      { controllerId: 'deck2', stripIndex: 0, x: 3, width: 3 }
    ]
  }, frameFor(pixels.slice(0, 6)));

  assert.deepEqual(mapped.get('deck1')[0].pixels, [['a'], ['b'], ['c']]);
  assert.deepEqual(mapped.get('deck2')[0].pixels, [['d'], ['e'], ['f']]);
});

test('maps a parallel layout to the same logical pixels', () => {
  const mapped = mapCanvasFrame({
    width: 3, height: 1,
    mappings: [
      { controllerId: 'deck1', stripIndex: 0, layout: 'parallel', width: 3 },
      { controllerId: 'deck1', stripIndex: 1, layout: 'parallel', width: 3 }
    ]
  }, frameFor(pixels.slice(0, 3)));

  assert.deepEqual(mapped.get('deck1').map(frame => frame.pixels), [
    [['a'], ['b'], ['c']],
    [['a'], ['b'], ['c']]
  ]);
});

test('reverses every other row for a serpentine layout', () => {
  const mapped = mapCanvasFrame({
    width: 3, height: 2,
    mappings: [{ controllerId: 'deck1', stripIndex: 0, layout: 'serpentine', width: 3, height: 2 }]
  }, frameFor(pixels.slice(0, 6)));

  assert.deepEqual(mapped.get('deck1')[0].pixels, [
    ['a'], ['b'], ['c'], ['f'], ['e'], ['d']
  ]);
});
