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

test('wires a serpentine matrix from any origin corner and axis, even with an odd run count', () => {
  // 3 columns x 3 rows (an odd number of runs either way) - a size that
  // previously collapsed distinct corners together when corners were
  // expressed as rotation + a single whole-list reverse.
  const grid = [
    ['a'], ['b'], ['c'],
    ['d'], ['e'], ['f'],
    ['g'], ['h'], ['i']
  ];

  function wire(originCorner, axis) {
    const mapped = mapCanvasFrame({
      width: 3, height: 3,
      mappings: [{ controllerId: 'deck1', stripIndex: 0, layout: 'serpentine', width: 3, height: 3, originCorner, axis }]
    }, frameFor(grid));
    return mapped.get('deck1')[0].pixels;
  }

  assert.deepEqual(wire('top-left', 'horizontal'), [
    ['a'], ['b'], ['c'], ['f'], ['e'], ['d'], ['g'], ['h'], ['i']
  ]);
  assert.deepEqual(wire('top-right', 'horizontal'), [
    ['c'], ['b'], ['a'], ['d'], ['e'], ['f'], ['i'], ['h'], ['g']
  ]);
  assert.deepEqual(wire('bottom-left', 'horizontal'), [
    ['g'], ['h'], ['i'], ['f'], ['e'], ['d'], ['a'], ['b'], ['c']
  ]);
  assert.deepEqual(wire('bottom-right', 'horizontal'), [
    ['i'], ['h'], ['g'], ['d'], ['e'], ['f'], ['c'], ['b'], ['a']
  ]);
  assert.deepEqual(wire('top-left', 'vertical'), [
    ['a'], ['d'], ['g'], ['h'], ['e'], ['b'], ['c'], ['f'], ['i']
  ]);

  // All four corners must be distinct for an odd-sized matrix - this is the
  // bug a rotation+reversed-only model could not express.
  const variants = [
    wire('top-left', 'horizontal'),
    wire('top-right', 'horizontal'),
    wire('bottom-left', 'horizontal'),
    wire('bottom-right', 'horizontal')
  ].map((pixels) => JSON.stringify(pixels));
  assert.equal(new Set(variants).size, 4);
});
