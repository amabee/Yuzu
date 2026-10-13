// Pure geometry for the welcome page mascot: its glide route, how scroll maps onto
// that route, and the shapes its mouth can make. Kept free of the DOM so it can be tested.

export type Point = { x: number; y: number };
export type Band = { top: number; bottom: number };
/** A route waypoint. `at` is where on screen (fraction of viewport height) the mascot
 *  should be when it reaches the point; `ease` slows it in and out of the point. */
export type Waypoint = Point & {
  at?: number;
  ease?: boolean;
  start?: true;
  end?: true;
};
export type Key = { len: number; scroll: number; ease: boolean };

export const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

/**
 * Down the right-hand lane past content, and a full-width glide through every empty
 * gap between content bands. `clearAt(y)` is how far a sweep must stay from the
 * content above and below; `halfAt(y)` is half the mascot's width at that depth.
 */
export function glideRoute(o: {
  origin: Point;
  end: Point;
  bands: Band[];
  railX: number;
  farX: number;
  laneWidth: number;
  clearAt: (y: number) => number;
  halfAt: (y: number) => number;
}): Waypoint[] {
  const pts: Waypoint[] = [{ ...o.origin, start: true }];
  for (let i = 0; i < o.bands.length - 1; i++) {
    const g0 = Math.max(o.bands[i].bottom, o.origin.y + 60);
    const g1 = o.bands[i + 1].top;
    if (g1 > o.end.y) continue;
    const top = g0 + o.clearAt(g0);
    const bottom = g1 - o.clearAt(g1);
    if (bottom - top < 40) continue;
    // Start the sweep low on screen and finish it high, so it gets plenty of scrolling
    // to cross, and ease each half so it slows into the far turn like a pendulum.
    pts.push(
      { x: o.railX, y: top, at: 0.72 },
      { x: o.farX, y: (top + bottom) / 2, at: 0.5, ease: true },
      { x: o.railX, y: bottom, at: 0.28, ease: true },
    );
  }
  pts.push({ ...o.end, end: true });

  // A gentle sway on long stretches down the lane, so it never just drops.
  const route: Waypoint[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const p = route[route.length - 1];
    const q = pts[i];
    const dy = q.y - p.y;
    if (dy > 900 && Math.abs(p.x - q.x) < 2) {
      const n = Math.floor(dy / 600);
      for (let k = 1; k <= n; k++) {
        const y = p.y + (dy * k) / (n + 1);
        const sway = Math.max(
          0,
          Math.min(46, o.laneWidth / 2 - o.halfAt(y) - 8),
        );
        route.push({ x: o.railX + (k % 2 ? -sway : sway), y, at: 0.5 });
      }
    }
    route.push(q);
  }
  return route;
}

/** One cubic segment per hop, with vertical tangents at every waypoint:
 *  smooth S-curves that always head downward. */
export function routeSegments(route: Point[]): string[] {
  const segments = [`M${route[0].x} ${route[0].y}`];
  for (let i = 1; i < route.length; i++) {
    const p = route[i - 1];
    const q = route[i];
    const h = (q.y - p.y) / 2;
    segments.push(`C${p.x} ${p.y + h} ${q.x} ${q.y - h} ${q.x} ${q.y}`);
  }
  return segments;
}

/** Scroll position at which the mascot reaches each waypoint, kept strictly increasing. */
export function scrollKeys(
  route: Waypoint[],
  lengths: number[],
  viewportHeight: number,
  finishScroll: number,
): Key[] {
  const keys = route.map((q, i) => {
    const scroll = q.start
      ? 0
      : q.end
        ? finishScroll
        : q.y - viewportHeight * (q.at ?? 0.5);
    return {
      len: lengths[i],
      scroll: clamp(scroll, 0, finishScroll),
      ease: !!q.ease,
    };
  });
  for (let i = 1; i < keys.length; i++)
    keys[i].scroll = Math.max(keys[i].scroll, keys[i - 1].scroll + 1);
  return keys;
}

/** Distance along the route for a scroll position, eased through the sweeps. */
export function lengthAtScroll(keys: Key[], scroll: number, total: number) {
  if (keys.length < 2) return 0;
  const last = keys[keys.length - 1];
  if (scroll >= last.scroll) return total;
  let i = 0;
  while (i < keys.length - 2 && keys[i + 1].scroll <= scroll) i++;
  const k0 = keys[i];
  const k1 = keys[i + 1];
  let t = clamp((scroll - k0.scroll) / (k1.scroll - k0.scroll), 0, 1);
  if (k1.ease) t = t * t * (3 - 2 * t);
  return k0.len + (k1.len - k0.len) * t;
}

/* ---------- Mouth ---------- */

export type MouthShape = { w: number; h: number; tilt: number; bulge: number };
export const FACES = {
  grin: { w: 18, h: 28, tilt: 0, bulge: 0 },
  smile: { w: 16, h: 2, tilt: 0, bulge: -7 }, // closed, just a curved line
  small: { w: 12, h: 10, tilt: 0, bulge: -2 },
  oh: { w: 8, h: 15, tilt: 0, bulge: 8 },
  laugh: { w: 20, h: 34, tilt: 0, bulge: 0 },
  smirk: { w: 16, h: 3, tilt: 5, bulge: -6 }, // lopsided closed smile
  wow: { w: 13, h: 31, tilt: 0, bulge: 7 }, // cursor on its face
} satisfies Record<string, MouthShape>;
export type Face = keyof typeof FACES;
export const MOODS: [Face, number][] = [
  ["grin", 3],
  ["smile", 3],
  ["small", 2],
  ["oh", 1],
  ["laugh", 1.5],
  ["smirk", 1.5],
];

/** The mouth outline (in logo coordinates) and where the tongue sits inside it. */
export function mouthShape({ w, h, tilt, bulge }: MouthShape) {
  const k = Math.max(h, 0.5);
  const lx = 138 - w;
  const ly = 162 - tilt;
  const rx = 138 + w;
  const ry = 162 + tilt;
  const d =
    `M${lx} ${ly} Q138 ${162 - bulge} ${rx} ${ry} ` +
    `C${rx} ${ry + k * 0.57} ${138 + w * 0.55} ${162 + k} 138 ${162 + k} ` +
    `C${138 - w * 0.55} ${162 + k} ${lx} ${ly + k * 0.57} ${lx} ${ly} Z`;
  return {
    d,
    tongue: {
      cy: 160 + k,
      rx: w * 0.6,
      ry: Math.max(k * 0.29, 0.1),
      opacity: clamp((h - 8) / 10, 0, 1),
    },
  };
}

/** Weighted random pick of the next expression, never repeating the current one. */
export function pickMood(current: Face, random = Math.random): Face {
  const options = MOODS.filter(([name]) => name !== current);
  let r = random() * options.reduce((sum, [, weight]) => sum + weight, 0);
  for (const [name, weight] of options) if ((r -= weight) <= 0) return name;
  return options[options.length - 1][0];
}
