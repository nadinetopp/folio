import { describe, expect, it } from "vitest";
import { clusterPositions, extractRulings, rulingGrids } from "./rulings";

const SAVE = 10, RESTORE = 11, TRANSFORM = 12, MOVE = 13, LINE = 14, RECT = 19, STROKE = 20, FILL = 22, CONSTRUCT = 91;
const DRAW_MOVE = 0, DRAW_LINE = 1, DRAW_CLOSE = 4;

describe("extractRulings", () => {
  it("reads a stroked horizontal and vertical line", () => {
    const rulings = extractRulings(
      [MOVE, LINE, STROKE, MOVE, LINE, STROKE],
      [[72, 700], [400, 700], [], [72, 700], [72, 620], []],
    );
    expect(rulings).toEqual([
      { axis: "h", at: 700, from: 72, to: 400 },
      { axis: "v", at: 72, from: 620, to: 700 },
    ]);
  });

  it("turns a stroked rectangle into four edges and ignores a large fill", () => {
    const rulings = extractRulings(
      [RECT, STROKE, RECT, FILL],
      [[72, 620, 200, 80], [], [10, 10, 100, 40], []],
    );
    expect(rulings).toHaveLength(4);
    expect(rulings.filter(rule => rule.axis === "h").map(rule => rule.at).sort((a, b) => a - b)).toEqual([620, 700]);
    expect(rulings.filter(rule => rule.axis === "v").map(rule => rule.at).sort((a, b) => a - b)).toEqual([72, 272]);
  });

  it("treats a thin filled rectangle as one rule and applies the current transform", () => {
    const thin = [DRAW_MOVE, 0, 0, DRAW_LINE, 200, 0, DRAW_LINE, 200, 1.2, DRAW_LINE, 0, 1.2, DRAW_CLOSE];
    const rulings = extractRulings(
      [SAVE, TRANSFORM, CONSTRUCT, RESTORE],
      [[], [1, 0, 0, 1, 72, 600], [FILL, [thin], null], []],
    );
    expect(rulings).toHaveLength(1);
    expect(rulings[0].axis).toBe("h");
    expect(rulings[0].from).toBeCloseTo(72);
    expect(rulings[0].to).toBeCloseTo(272);
    expect(rulings[0].at).toBeCloseTo(600.6);
  });

  it("reads a constructPath stroke the way pdf.js records a drawn line", () => {
    const coords = [DRAW_MOVE, 72, 700, DRAW_MOVE, 72, 700, DRAW_LINE, 500, 700];
    const rulings = extractRulings([CONSTRUCT], [[STROKE, [Float32Array.from(coords)], null]]);
    expect(rulings).toEqual([{ axis: "h", at: 700, from: 72, to: 500 }]);
  });
});

describe("rulingGrids", () => {
  it("finds one grid of two columns and two rows, and not a single box", () => {
    const rules = extractRulings(
      [MOVE, LINE, STROKE, MOVE, LINE, STROKE, MOVE, LINE, STROKE, MOVE, LINE, STROKE, MOVE, LINE, STROKE],
      [
        [72, 700], [320, 700], [],
        [72, 660], [320, 660], [],
        [72, 620], [320, 620], [],
        [72, 620], [72, 700], [],
        [220, 620], [220, 700], [],
      ],
    );
    // The right-hand rule is missing, so this is not yet two columns. Add it.
    rules.push({ axis: "v", at: 320, from: 620, to: 700 });
    expect(rulingGrids(rules)).toEqual([{ xs: [72, 220, 320], ys: [620, 660, 700] }]);
    expect(rulingGrids([{ axis: "h", at: 700, from: 72, to: 320 }, { axis: "h", at: 620, from: 72, to: 320 },
      { axis: "v", at: 72, from: 620, to: 700 }, { axis: "v", at: 320, from: 620, to: 700 }])).toEqual([]);
  });

  it("keeps two separate grids apart", () => {
    const left = [
      { axis: "h" as const, at: 400, from: 40, to: 180 },
      { axis: "h" as const, at: 360, from: 40, to: 180 },
      { axis: "h" as const, at: 320, from: 40, to: 180 },
      { axis: "v" as const, at: 40, from: 320, to: 400 },
      { axis: "v" as const, at: 110, from: 320, to: 400 },
      { axis: "v" as const, at: 180, from: 320, to: 400 },
    ];
    const right = left.map(rule => rule.axis === "h"
      ? { ...rule, from: rule.from + 300, to: rule.to + 300 }
      : { ...rule, at: rule.at + 300 });
    const grids = rulingGrids([...left, ...right]);
    expect(grids).toHaveLength(2);
    expect(grids[0].xs[0]).toBeLessThan(grids[1].xs[0]);
  });
});

describe("clusterPositions", () => {
  it("collapses a double rule and keeps the next row", () => {
    expect(clusterPositions([700, 700.4, 678, 656])).toEqual([656, 678, 700.2]);
  });
});
