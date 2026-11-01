const { masonryColumnCount, placeInColumns } = require('./masonry');

describe('column count (same breakpoints as before)', () => {
  test('phone: 2', () => expect(masonryColumnCount(400, 372)).toBe(2));
  test('tablet: up to 3 of ≥170px', () => {
    expect(masonryColumnCount(800, 772)).toBe(3);
    expect(masonryColumnCount(560, 532)).toBe(2);
  });
  test('desktop: up to 5 of ≥240px', () => {
    expect(masonryColumnCount(1280, 1236)).toBe(4);
    expect(masonryColumnCount(1600, 1456)).toBe(5);
    expect(masonryColumnCount(2560, 1456)).toBe(5);
  });
});

describe('placement keeps reading order', () => {
  const run = (heights, n) => {
    const tops = []; const colH = new Array(n).fill(0);
    const cols = placeInColumns(heights, n, (h, c) => { tops.push({ c, top: colH[c] }); colH[c] += h; return h; });
    return { cols, tops };
  };
  test('first row fills left → right', () => {
    expect(run([300, 220, 380, 260, 240], 3).cols.slice(0, 3)).toEqual([0, 1, 2]);
  });
  test('every card starts at or below the previous card (sorted lists read across then down)', () => {
    const heights = Array.from({ length: 70 }, (_, i) => [220, 300, 260, 340, 240, 310, 280, 380][i % 8] + 70);
    for (const n of [2, 3, 4, 5]) {
      const { tops } = run(heights, n);
      for (let i = 1; i < tops.length; i++) expect(tops[i].top).toBeGreaterThanOrEqual(tops[i - 1].top);
    }
  });
  test('equal heights = simple left-to-right rows', () => {
    expect(run([100, 100, 100, 100, 100, 100], 3).cols).toEqual([0, 1, 2, 0, 1, 2]);
  });
});
