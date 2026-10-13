import { describe, expect, it } from "vitest";
import {
  FACES,
  glideRoute,
  lengthAtScroll,
  mouthShape,
  pickMood,
  routeSegments,
  scrollKeys,
} from "./glide-math";

const base = {
  origin: { x: 1500, y: 450 },
  end: { x: 1700, y: 5000 },
  railX: 1700,
  farX: 150,
  laneWidth: 360,
  clearAt: () => 100,
  halfAt: () => 80,
};

describe("glideRoute", () => {
  it("sweeps across every gap that is tall enough and skips the rest", () => {
    const route = glideRoute({
      ...base,
      bands: [
        { top: 200, bottom: 700 }, // hero copy
        { top: 1200, bottom: 2600 }, // 500px gap above: room to sweep
        { top: 2700, bottom: 3800 }, // 100px gap above: too tight
        { top: 4400, bottom: 4700 }, // 600px gap above: room to sweep
      ],
    });
    const far = route.filter((p) => p.x === base.farX);
    expect(far).toHaveLength(2);
    far.forEach((p) => expect(p.ease).toBe(true));
    expect(route[0]).toMatchObject({ ...base.origin, start: true });
    expect(route.at(-1)).toMatchObject({ ...base.end, end: true });
  });

  it("keeps each sweep clear of the content above and below it", () => {
    const route = glideRoute({
      ...base,
      bands: [
        { top: 0, bottom: 700 },
        { top: 1300, bottom: 2000 },
      ],
    });
    const sweeps = route.filter((p) => p.x === base.farX); // out over the page, away from the lane
    expect(sweeps.length).toBeGreaterThan(0);
    sweeps.forEach((p) => {
      expect(p.y).toBeGreaterThanOrEqual(700 + 100);
      expect(p.y).toBeLessThanOrEqual(1300 - 100);
    });
  });

  it("always moves downward", () => {
    const route = glideRoute({
      ...base,
      bands: [
        { top: 0, bottom: 700 },
        { top: 1300, bottom: 4000 },
      ],
    });
    for (let i = 1; i < route.length; i++)
      expect(route[i].y).toBeGreaterThan(route[i - 1].y);
  });
});

describe("routeSegments", () => {
  it("starts with a move and adds one cubic per hop", () => {
    const segments = routeSegments([
      { x: 0, y: 0 },
      { x: 100, y: 200 },
      { x: 0, y: 400 },
    ]);
    expect(segments[0]).toBe("M0 0");
    expect(segments.slice(1).every((s) => s.startsWith("C"))).toBe(true);
    expect(segments[1]).toBe("C0 100 100 100 100 200");
  });
});

describe("scroll mapping", () => {
  const route = [
    { x: 0, y: 450, start: true as const },
    { x: 0, y: 1500, at: 0.72 },
    { x: 0, y: 1700, at: 0.5, ease: true },
    { x: 0, y: 5000, end: true as const },
  ];
  const keys = scrollKeys(route, [0, 1000, 1500, 4000], 900, 4000);

  it("starts at the top, finishes at the landing scroll and only increases", () => {
    expect(keys[0].scroll).toBe(0);
    expect(keys.at(-1)!.scroll).toBe(4000);
    for (let i = 1; i < keys.length; i++)
      expect(keys[i].scroll).toBeGreaterThan(keys[i - 1].scroll);
  });

  it("maps scroll to distance along the route, eased into turns", () => {
    expect(lengthAtScroll(keys, 0, 4000)).toBe(0);
    expect(lengthAtScroll(keys, 4000, 4000)).toBe(4000);
    expect(lengthAtScroll(keys, 9999, 4000)).toBe(4000);
    const k1 = keys[1].scroll;
    const k2 = keys[2].scroll;
    // halfway through an eased hop is still halfway, but the quarter mark lags behind
    expect(lengthAtScroll(keys, (k1 + k2) / 2, 4000)).toBeCloseTo(1250);
    expect(lengthAtScroll(keys, k1 + (k2 - k1) / 4, 4000)).toBeLessThan(1125);
  });
});

describe("mouth", () => {
  it("draws the logo's own grin as the resting shape", () => {
    const { d, tongue } = mouthShape(FACES.grin);
    expect(d.startsWith("M120 162 Q138 162 156 162")).toBe(true);
    expect(d).toContain("138 190");
    expect(tongue.opacity).toBe(1);
  });

  it("hides the tongue when the mouth is closed", () => {
    expect(mouthShape(FACES.smile).tongue.opacity).toBe(0);
  });

  it("picks a different expression each time", () => {
    for (const r of [0, 0.3, 0.6, 0.999])
      expect(pickMood("grin", () => r)).not.toBe("grin");
    expect(pickMood("smile", () => 0)).toBe("grin");
  });
});
