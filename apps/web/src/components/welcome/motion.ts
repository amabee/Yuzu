import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import {
  clamp,
  FACES,
  glideRoute,
  lengthAtScroll,
  mouthShape,
  pickMood,
  routeSegments,
  scrollKeys,
  type Band,
  type Face,
  type Key,
} from "./glide-math";

gsap.registerPlugin(ScrollTrigger);

const SPLASH_SEEN = "yuzu:welcome-splash";
type Listen = (
  target: EventTarget,
  type: string,
  fn: (event: never) => void,
  options?: AddEventListenerOptions,
) => void;

/**
 * Everything that moves on the welcome page: the splash, the hero intro, the two
 * scroll scenes, the gliding mascot with its cursor follow and mouth, and the top bar.
 * Returns a cleanup that undoes all of it (listeners, tickers, pins and inline styles).
 */
export function initWelcomeMotion(root: HTMLElement): () => void {
  const $ = <T extends Element = HTMLElement>(id: string) =>
    root.querySelector<T>(`#${id}`)!;
  const cleanups: (() => void)[] = [];
  const listen: Listen = (target, type, fn, options) => {
    target.addEventListener(type, fn as EventListener, options);
    cleanups.push(() =>
      target.removeEventListener(type, fn as EventListener, options),
    );
  };
  const html = document.documentElement;
  let disposed = false;
  let stopSplash = () => {};

  // Top bar gets a background once the page has scrolled.
  const topBar = $("top");
  const markScrolled = () => topBar.classList.toggle("scrolled", scrollY > 40);
  listen(window, "scroll", markScrolled, { passive: true });
  markScrolled();

  const scenes = setUpScenes(root, listen);
  const glide = setUpMascot(root, listen);
  const mm = gsap.matchMedia();

  mm.add("(prefers-reduced-motion: no-preference)", () => {
    // One orchestrated load moment after the splash: the mascot pops in, the headline rises.
    const intro = gsap.timeline({
      paused: true,
      defaults: { ease: "power3.out" },
    });
    intro
      .from(
        $("mLand"),
        {
          y: -50,
          scale: 0.5,
          opacity: 0,
          duration: 0.9,
          ease: "back.out(1.8)",
          transformOrigin: "50% 100%",
        },
        0.1,
      )
      .from(
        root.querySelectorAll("h1 .ln>span"),
        { yPercent: 110, duration: 0.9, stagger: 0.12 },
        0.2,
      )
      .from(
        root.querySelectorAll(".lede, .cta, .fine"),
        { opacity: 0, y: 14, duration: 0.6, stagger: 0.08 },
        0.7,
      );
    scenes.animate();
    stopSplash = runSplash(
      root,
      $,
      listen,
      () => intro.play(),
      () => disposed,
    );
  });
  mm.add("(prefers-reduced-motion: reduce)", () => {
    $("splash").style.display = "none";
    return scenes.still();
  });

  return () => {
    disposed = true;
    stopSplash();
    cleanups.reverse().forEach((undo) => undo());
    glide.dispose();
    mm.revert();
    gsap.defaults({ force3D: "auto" });
    html.classList.remove("splashing");
    html.style.overflow = "";
  };
}

/* ---------- Splash: the letters rise from the ground, the yuzu stomps the u into a z and bounces home ---------- */

function runSplash(
  root: HTMLElement,
  $: <T extends Element = HTMLElement>(id: string) => T,
  listen: Listen,
  onReveal: () => void,
  isDisposed: () => boolean,
): () => void {
  const sp = $("splash");
  let seen = false;
  try {
    seen = sessionStorage.getItem(SPLASH_SEEN) === "1";
  } catch {}
  // Skip it when it has already played this session, or nobody can see it (a background tab).
  if (seen || document.hidden) {
    sp.style.display = "none";
    onReveal();
    return () => {};
  }
  let stop = () => {};
  const html = document.documentElement;
  html.style.overflow = "hidden";
  html.classList.add("splashing"); // pause the hidden page's idle animations meanwhile
  const word = $("spWord");
  const family = getComputedStyle(word).fontFamily;
  // Lay the letters out with the brand font's real measurements: wait for that exact face
  // (the first family; the rest are fallbacks), but never for long.
  const brand = family.split(",")[0].trim();
  const fontReady = document.fonts
    ? document.fonts.load(`800 200px ${brand}`)
    : Promise.resolve();
  Promise.race([fontReady, new Promise((r) => setTimeout(r, 3000))])
    .catch(() => {})
    .then(() => {
      if (!isDisposed()) play();
    });
  return () => stop();

  function play() {
    const stage = $("spStage");
    const pos = $("spPos");
    const fruit = $("spFruit");
    const shadow = $("spShadow");
    const L = [0, 1, 2, 3].map((i) => $(`spL${i}`));
    const uAt2 = $("spU");
    const zAt2 = $("spZ");

    // Size the type to the screen, then measure everything in px relative to the stage's centre.
    const FS = Math.min((innerWidth * 0.92) / 3.4, 340);
    word.style.fontSize = `${FS}px`;
    const ctx = document.createElement("canvas").getContext("2d");
    if (ctx) ctx.font = `800 ${FS}px ${family}`;
    const xh = ctx?.measureText("u").actualBoundingBoxAscent || FS * 0.52;
    const fruitH = xh * 1.45;
    const fruitW = (fruitH * 176) / 216;
    const gap = 0.12 * FS;
    const left = -(fruitW + gap + word.offsetWidth) / 2;
    word.style.left = `${left + fruitW + gap}px`;
    word.style.top = `${-word.offsetHeight / 2}px`;
    const st = stage.getBoundingClientRect();
    const rel = (r: DOMRect) => ({
      x: r.left - st.left,
      y: r.top - st.top,
      w: r.width,
      h: r.height,
    });
    const GROUND = rel($("spBase").getBoundingClientRect()).y; // baseline
    const TOP = GROUND - xh; // top of the x-height
    const boxes = L.map((el) => rel(el.getBoundingClientRect()));
    const centers = boxes.map((b) => b.x + b.w / 2);
    const originY = `${((GROUND - boxes[0].y) / boxes[0].h) * 100}%`; // letters squash about the baseline
    const HOME = left + fruitW / 2;
    Object.assign(fruit.style, {
      width: `${fruitW}px`,
      height: `${fruitH}px`,
      left: `${-fruitW / 2}px`,
      top: `${-fruitH}px`,
    });
    Object.assign(shadow.style, {
      width: `${fruitW * 0.76}px`,
      height: `${xh * 0.14}px`,
      left: `${-fruitW * 0.38}px`,
      top: `${GROUND + xh * 0.03}px`,
    });
    stage.style.visibility = "visible";

    const leaves = $("spLeaves");
    const eyes = root.querySelectorAll(".sp-eye");
    gsap.set(L, { transformOrigin: `50% ${originY}`, y: FS * 1.3 }); // waiting below the ground
    gsap.set(pos, { x: centers[2], y: -(innerHeight * 0.6 + fruitH) });
    gsap.set(fruit, { transformOrigin: "50% 100%", scaleX: 0.9, scaleY: 1.14 });
    gsap.set(eyes, { transformOrigin: "50% 50%" });

    // The shadow follows along the ground and shrinks the higher the yuzu is (transforms only).
    const shadowX = gsap.quickSetter(shadow, "x", "px");
    const shadowS = gsap.quickSetter(shadow, "scaleX");
    const shadowO = gsap.quickSetter(shadow, "opacity");
    const follow = () => {
      const lift = clamp(
        (GROUND - Number(gsap.getProperty(pos, "y"))) / (3.5 * xh),
        0,
        1,
      );
      shadowX(gsap.getProperty(pos, "x"));
      shadowS(1 - 0.7 * lift);
      shadowO(0.16 * (1 - 0.8 * lift));
    };
    gsap.ticker.add(follow);
    const impact = () => {
      gsap.fromTo(
        leaves,
        { rotation: -18 },
        {
          rotation: 0,
          svgOrigin: "140 80",
          duration: 0.8,
          ease: "elastic.out(1,.3)",
          overwrite: true,
        },
      );
      gsap.fromTo(
        eyes,
        { scaleY: 0.2 },
        {
          scaleY: 1,
          duration: 0.24,
          delay: 0.05,
          ease: "power2.out",
          overwrite: true,
        },
      );
    };
    const flutter = gsap.fromTo(
      leaves,
      { rotation: -10 },
      {
        rotation: 12,
        svgOrigin: "140 80",
        duration: 0.14,
        ease: "sine.inOut",
        yoyo: true,
        repeat: -1,
        paused: true,
      },
    );
    const dip = (el: HTMLElement) =>
      gsap
        .timeline()
        .to(el, {
          y: 0.17 * xh,
          scaleY: 0.78,
          scaleX: 1.12,
          duration: 0.08,
          ease: "power2.out",
        })
        .to(el, {
          y: 0,
          scaleY: 1,
          scaleX: 1,
          duration: 0.6,
          ease: "elastic.out(1,.35)",
        });

    gsap.defaults({ force3D: false }); // plain 2D transforms keep the type sharp while it scales
    const tl = gsap.timeline({ delay: 0.3 });
    // 1. The letters rise out of the ground one at a time, overshoot a little and settle.
    tl.to(L, { y: 0, duration: 0.55, ease: "back.out(1.8)", stagger: 0.14 }, 0);
    // 2. The yuzu falls onto the third letter and flattens it like a trampoline; it springs back up as a z.
    const FALL = 1.05;
    const STOMP = FALL + 0.55;
    tl.add(() => void flutter.play(), FALL)
      .to(pos, { y: TOP, duration: 0.55, ease: "power2.in" }, FALL)
      .add(() => {
        flutter.pause();
        impact();
      }, STOMP)
      .to(
        fruit,
        { scaleX: 1.3, scaleY: 0.7, duration: 0.08, ease: "power2.out" },
        STOMP,
      )
      .to(
        pos,
        { y: TOP + 0.55 * xh, duration: 0.09, ease: "power2.out" },
        STOMP,
      )
      .to(
        L[2],
        { scaleY: 0.3, scaleX: 1.3, duration: 0.09, ease: "power2.out" },
        STOMP,
      )
      .set(uAt2, { opacity: 0 }, STOMP + 0.09)
      .set(zAt2, { opacity: 1 }, STOMP + 0.09)
      .to(
        L[2],
        { scaleY: 1, scaleX: 1, duration: 0.75, ease: "elastic.out(1.1,.3)" },
        STOMP + 0.1,
      )
      .to(
        fruit,
        { scaleX: 0.92, scaleY: 1.1, duration: 0.1, ease: "power2.in" },
        STOMP + 0.08,
      );
    // 3. Three bounces, landing on the letters on the way home, each lower and quicker.
    // Bounce heights are capped by the room above the word, so the yuzu never leaves the screen.
    const room = st.top + TOP - fruitH - 32;
    const lift = (k: number) =>
      Math.max(xh * 0.5, Math.min(k * xh, (room * k) / 2.5));
    const hops: [number, number, number, number, HTMLElement | null][] = [
      [centers[1], TOP, lift(2.5), 0.34, L[1]],
      [centers[0], TOP, lift(1.4), 0.26, L[0]],
      [HOME, GROUND, lift(0.8), 0.2, null],
    ];
    let t = STOMP + 0.12;
    let from = TOP + 0.55 * xh;
    hops.forEach(([hx, landY, h, d, letter], i) => {
      const last = i === hops.length - 1;
      tl.to(pos, { x: hx, duration: d * 2, ease: "none" }, t)
        .to(
          pos,
          { y: Math.min(from, landY) - h, duration: d, ease: "power2.out" },
          t,
        )
        .to(
          fruit,
          { scaleX: 1, scaleY: 1, duration: d * 0.6, ease: "power1.out" },
          t + 0.05,
        )
        .to(pos, { y: landY, duration: d, ease: "power2.in" }, t + d)
        .to(
          fruit,
          { scaleX: 0.95, scaleY: 1.06, duration: d * 0.6, ease: "power1.in" },
          t + d * 1.4,
        )
        .add(impact, t + d * 2)
        .to(
          fruit,
          { scaleX: 1.24, scaleY: 0.76, duration: 0.07, ease: "power2.out" },
          t + d * 2,
        )
        .to(
          fruit,
          last
            ? { scaleX: 1, scaleY: 1, duration: 0.6, ease: "elastic.out(1,.4)" }
            : { scaleX: 0.93, scaleY: 1.1, duration: 0.09, ease: "power2.in" },
          t + d * 2 + 0.07,
        );
      if (letter) tl.add(dip(letter), t + d * 2);
      from = landY;
      t += d * 2 + 0.07;
    });
    // 4. The word ripples, the yuzu glances over and blinks, then the curtain lifts.
    const finish = () => {
      gsap.defaults({ force3D: "auto" });
      gsap.ticker.remove(follow);
      flutter.kill();
      gsap.killTweensOf([leaves, ...eyes]);
      sp.style.display = "none";
      html.style.overflow = "";
      ScrollTrigger.refresh();
    };
    tl.addLabel("wave", t + 0.2)
      .to(
        L,
        {
          y: -0.22 * xh,
          duration: 0.18,
          ease: "sine.out",
          stagger: 0.07,
          yoyo: true,
          repeat: 1,
        },
        "wave",
      )
      .to(eyes, { x: 3, duration: 0.25, ease: "power2.out" }, "wave")
      .to(
        eyes,
        { scaleY: 0.1, duration: 0.07, yoyo: true, repeat: 1 },
        "wave+=.55",
      )
      .add(
        () =>
          void gsap.fromTo(
            leaves,
            { rotation: -5 },
            {
              rotation: 6,
              svgOrigin: "140 80",
              duration: 1.1,
              ease: "sine.inOut",
              yoyo: true,
              repeat: -1,
            },
          ),
        "wave+=.3",
      )
      .to(
        sp,
        { yPercent: -100, duration: 0.9, ease: "power3.inOut" },
        "wave+=1.25",
      )
      .add(() => {
        html.classList.remove("splashing");
        try {
          sessionStorage.setItem(SPLASH_SEEN, "1");
        } catch {}
        onReveal();
      }, "<.35")
      .add(finish);

    // Keyboard users can still hurry it along.
    listen(
      window,
      "keydown",
      (e: KeyboardEvent) => e.key === "Escape" && tl.timeScale(8),
    );
    // Everything above was measured for this window size; if it changes (or the page is
    // hidden) mid-play, finish now rather than carry on with stale positions.
    const size = `${innerWidth}x${innerHeight}`;
    const skip = () => {
      if (tl.progress() < 1) tl.progress(1);
    };
    listen(window, "resize", () => {
      if (`${innerWidth}x${innerHeight}` !== size) skip();
    });
    listen(document, "visibilitychange", () => document.hidden && skip());
    listen(window, "pagehide", skip);
    // Leaving the page or a hot reload: stop the splash outright and undo what it changed.
    stop = () => {
      tl.kill();
      flutter.kill();
      gsap.ticker.remove(follow);
      gsap.killTweensOf([leaves, ...eyes, ...L, pos, fruit, shadow, sp]);
      gsap.set([...L, pos, fruit, shadow, sp, uAt2, zAt2, leaves, ...eyes], {
        clearProps: "all",
      });
      word.removeAttribute("style");
      stage.style.visibility = "";
    };
  }
}

/* ---------- The two scroll scenes: table rows becoming Kanban cards, and an approval ---------- */

function setUpScenes(root: HTMLElement, listen: Listen) {
  const stageIn = root.querySelector<HTMLElement>("#stageIn")!;
  const items = [...stageIn.querySelectorAll<HTMLElement>(".item")];
  const lanes = [...stageIn.querySelectorAll<HTMLElement>(".lanebg")];
  const laneOf = (item: HTMLElement) => {
    const pill = item.querySelector(".pill")!;
    return lanes.findIndex((l) => pill.classList.contains(`s-${l.dataset.k}`));
  };
  const W = () => stageIn.clientWidth;
  const H = () => stageIn.clientHeight;
  const rowH = () => Math.min(52, (H() - 44) / items.length - 6);
  const T = (i: number) => ({
    x: 0,
    y: 42 + i * (rowH() + 6),
    width: W(),
    height: rowH(),
  });
  const colW = () => (W() - 24) / 3;
  const K = (i: number) => {
    const col = laneOf(items[i]);
    const k = items.slice(0, i).filter((o) => laneOf(o) === col).length;
    const ch = Math.min(96, (H() - 60) / 2 - 10);
    return {
      x: col * (colW() + 12) + 8,
      y: 46 + k * (ch + 10),
      width: colW() - 16,
      height: ch,
    };
  };
  const placeLanes = () =>
    lanes.forEach((l, c) => {
      l.style.left = `${c * (colW() + 12)}px`;
      l.style.width = `${colW()}px`;
    });
  placeLanes();
  listen(window, "resize", placeLanes);
  const toggles = [
    ...root.querySelectorAll<HTMLButtonElement>(".toggle button"),
  ];
  const press = (mode: string) =>
    toggles.forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.mode === mode)),
    );
  const gcard = root.querySelector<HTMLElement>("#gcard")!;
  const ghost = root.querySelector<HTMLElement>("#ghost")!;
  const beats = [...root.querySelectorAll<HTMLElement>(".beats li")];
  const q = (selector: string) => root.querySelectorAll(selector);

  return {
    animate() {
      // Pinned: the table rows become Kanban cards.
      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: root.querySelector("#see"),
          start: "top top",
          end: "+=1300",
          pin: true,
          scrub: 0.7,
          invalidateOnRefresh: true,
          onUpdate: (s) => press(s.progress > 0.5 ? "kanban" : "table"),
        },
      });
      tl.fromTo(
        items,
        {
          x: (i: number) => T(i).x,
          y: (i: number) => T(i).y,
          width: (i: number) => T(i).width,
          height: (i: number) => T(i).height,
        },
        {
          x: (i: number) => K(i).x,
          y: (i: number) => K(i).y,
          width: (i: number) => K(i).width,
          height: (i: number) => K(i).height,
          duration: 1,
          stagger: 0.05,
          ease: "power2.inOut",
        },
        0.15,
      )
        .to(q(".thead"), { opacity: 0, duration: 0.25 }, 0.1)
        .to(q(".rowv"), { opacity: 0, duration: 0.25 }, 0.25)
        .to(q(".cardv"), { opacity: 1, duration: 0.3 }, 0.7)
        .to(lanes, { opacity: 1, duration: 0.4, stagger: 0.08 }, 0.55)
        .to({}, { duration: 0.3 });
      toggles.forEach((b) => {
        b.onclick = () => {
          const st = tl.scrollTrigger!;
          scrollTo({
            top: b.dataset.mode === "kanban" ? st.end - 2 : st.start + 2,
            behavior: "smooth",
          });
        };
      });

      // Pinned: request, approval, move.
      const g = gsap.timeline({
        scrollTrigger: {
          trigger: root.querySelector("#gate"),
          start: "top top",
          end: "+=1500",
          pin: true,
          scrub: 0.7,
          invalidateOnRefresh: true,
        },
      });
      g.to(beats[0], { opacity: 1, duration: 0.2 })
        .fromTo(
          gcard,
          { x: 0, rotation: 0 },
          { x: 40, rotation: 2.5, duration: 0.25, ease: "power2.out" },
        )
        .to(gcard, { x: 0, rotation: 0, duration: 0.25, ease: "back.out(3)" })
        .to(ghost, { opacity: 1, duration: 0.2 }, "<")
        .to(beats[0], { opacity: 0.38, duration: 0.1 })
        .to(beats[1], { opacity: 1, duration: 0.2 }, "<")
        .fromTo(
          q("#req"),
          { opacity: 0, y: 30, scale: 0.96 },
          { opacity: 1, y: 0, scale: 1, duration: 0.3, ease: "back.out(1.7)" },
        )
        .to({}, { duration: 0.3 })
        .to(beats[1], { opacity: 0.38, duration: 0.1 })
        .to(beats[2], { opacity: 1, duration: 0.2 }, "<")
        .to(q("#okBtn"), { scale: 0.92, duration: 0.08, yoyo: true, repeat: 1 })
        .to(q("#req"), { opacity: 0, y: 20, duration: 0.25 })
        .to(gcard, {
          x: () => ghost.offsetLeft - gcard.offsetLeft,
          y: () => ghost.offsetTop - gcard.offsetTop,
          duration: 0.6,
          ease: "power3.inOut",
        })
        .to(ghost, { opacity: 0, duration: 0.2 }, "<.3")
        .to(q("#gtape .bgok, #gtape .yes"), { opacity: 1, duration: 0.2 }, "<")
        .to(q("#gtape .no"), { opacity: 0, duration: 0.2 }, "<")
        .to({}, { duration: 0.3 });
    },
    /** Reduced motion: no pinning or scrubbing. Everything is visible and the toggle switches instantly. */
    still() {
      let mode = "table";
      const set = () => {
        const L = mode === "kanban" ? K : T;
        items.forEach((it, i) => gsap.set(it, L(i)));
        gsap.set(q(".thead, .rowv"), { opacity: mode === "kanban" ? 0 : 1 });
        gsap.set(q(".cardv"), { opacity: mode === "kanban" ? 1 : 0 });
        gsap.set(lanes, { opacity: mode === "kanban" ? 1 : 0 });
        press(mode);
      };
      set();
      toggles.forEach((b) => {
        b.onclick = () => {
          mode = b.dataset.mode!;
          set();
        };
      });
      addEventListener("resize", set);
      gsap.set(beats, { opacity: 1 });
      gsap.set([ghost, ...q("#req")], { opacity: 1 });
      return () => {
        removeEventListener("resize", set);
        toggles.forEach((b) => (b.onclick = null));
      };
    },
  };
}

/* ---------- Mascot: cursor follow, the scroll-driven glide, and its mouth ---------- */

function setUpMascot(root: HTMLElement, listen: Listen) {
  const $ = <T extends Element = HTMLElement>(id: string) =>
    root.querySelector<T>(`#${id}`)!;
  const anchor = $("mAnchor");
  const fly = $("mFly");
  const follower = $("mFollow");
  const lander = $("mLand");
  const gaze = $<SVGGElement>("hmGaze");
  const landSpot = $("mLandSpot");
  const probe = $("railProbe");
  const trail = $<SVGSVGElement>("trail");
  const path = $<SVGPathElement>("trailPath");
  const reveal = $<SVGPathElement>("trailReveal");
  const mouthPath = $<SVGPathElement>("hmMouth");
  const mouthClip = $<SVGPathElement>("hmMouthClip");
  const tongue = $<SVGEllipseElement>("hmTongue");
  const fallQuery = matchMedia(
    "(min-width: 1200px) and (prefers-reduced-motion: no-preference)",
  );
  const followQuery = matchMedia(
    "(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)",
  );
  const motionQuery = matchMedia("(prefers-reduced-motion: no-preference)");
  const N = 1600;
  const xs = new Float32Array(N + 1);
  const ys = new Float32Array(N + 1);
  let falling = false;
  let following = false;
  let running = false;
  let landed = false;
  let total = 0;
  let origin = { x: 0, y: 0 };
  let startY = 0;
  let endY = 1;
  let endScale = 1;
  let finishScroll = 1;
  let railX = 0;
  let farX = 0;
  let current = 0;
  let target = 0;
  let bank = 0;
  let prevX: number | null = null;
  let hovering = false;
  let keys: Key[] = [];
  const pointer = { x: 0, y: 0, on: false };
  const nudge = { x: 0, y: 0 };
  const look = { x: 0, y: 0 };

  // Shrinks quicker at first, as if gliding away from you, and more still out on a sweep.
  const sizeAt = (p: number) =>
    1 + (endScale - 1) * Math.pow(clamp(p, 0, 1), 0.6);
  const awayAt = (x: number) =>
    railX === farX
      ? 0
      : clamp(Math.abs(x - railX) / Math.abs(railX - farX), 0, 1);
  const scaleAt = (p: number, x: number) => sizeAt(p) * (1 - 0.4 * awayAt(x));

  // Where the mascot is at a given distance along the path.
  function atLen(len: number) {
    if (!total) return origin;
    const f = (clamp(len, 0, total) / total) * N;
    const i = Math.min(Math.floor(f), N - 1);
    const t = f - i;
    return {
      x: xs[i] + (xs[i + 1] - xs[i]) * t,
      y: ys[i] + (ys[i + 1] - ys[i]) * t,
    };
  }

  // Page-space bands that hold content. A pinned section's content stays on screen
  // for the whole pin, so its band is stretched by the pin length.
  function contentBands(): Band[] {
    const pins = new Map(
      ScrollTrigger.getAll()
        .filter((t) => t.pin)
        .map((t) => [t.pin, t]),
    );
    return [...root.querySelectorAll<HTMLElement>("[data-band]")]
      .map((el) => {
        const kids = el.closest(".hero") ? [el] : [...el.children];
        let top = Infinity;
        let bottom = -Infinity;
        kids.forEach((k) => {
          const r = k.getBoundingClientRect();
          if (r.height) {
            top = Math.min(top, r.top);
            bottom = Math.max(bottom, r.bottom);
          }
        });
        const section = el.closest("section")!;
        const pin = pins.get(section);
        if (!pin) return { top: top + scrollY, bottom: bottom + scrollY };
        const s = section.getBoundingClientRect();
        return {
          top: pin.start + top - s.top,
          bottom: pin.start + bottom - s.top + (pin.end - pin.start),
        };
      })
      .filter((b) => Number.isFinite(b.top) && Number.isFinite(b.bottom));
  }

  function layout() {
    if (!falling) {
      total = 0;
      render();
      return;
    }
    const a = anchor.getBoundingClientRect();
    const e = landSpot.getBoundingClientRect();
    const lane = probe.getBoundingClientRect();
    origin = { x: a.left + a.width / 2, y: a.top + a.height / 2 + scrollY };
    const end = { x: e.left + e.width / 2, y: e.top + e.height / 2 + scrollY };
    startY = origin.y;
    endY = end.y;
    endScale = e.width / a.width;
    railX = lane.left + lane.width / 2;
    const progressAt = (y: number) => (y - startY) / (endY - startY);
    const halfAt = (y: number) => (a.width * sizeAt(progressAt(y))) / 2;
    farX = halfAt(startY) * 0.6 + 28;
    // Half the mascot's height once it has left the lane, plus room for the motion stretch.
    const clearAt = (y: number) =>
      ((a.height * sizeAt(progressAt(y)) * (1 - 0.4 * 0.12)) / 2) * 1.08 + 24;
    const route = glideRoute({
      origin,
      end,
      bands: contentBands(),
      railX,
      farX,
      laneWidth: lane.width,
      clearAt,
      halfAt,
    });
    const segments = routeSegments(route);

    trail.setAttribute("height", "0"); // don't let the old trail size hold the page open
    const W = document.documentElement.clientWidth;
    const H = document.documentElement.scrollHeight;
    trail.setAttribute("width", String(W));
    trail.setAttribute("height", String(H));
    trail.setAttribute("viewBox", `0 0 ${W} ${H}`);
    // Land near mid-screen, or at the very bottom on short pages.
    finishScroll = Math.max(
      1,
      Math.min(endY - innerHeight * 0.5, H - innerHeight),
    );
    const lengths = route.map((_, i) => {
      if (!i) return 0;
      path.setAttribute("d", segments.slice(0, i + 1).join(" "));
      return path.getTotalLength();
    });
    keys = scrollKeys(route, lengths, innerHeight, finishScroll);
    const d = segments.join(" ");
    path.setAttribute("d", d);
    reveal.setAttribute("d", d);
    total = path.getTotalLength();
    for (let i = 0; i <= N; i++) {
      const p = path.getPointAtLength((i / N) * total);
      xs[i] = p.x;
      ys[i] = p.y;
    }
    current = target = lengthAtScroll(keys, scrollY, total);
    prevX = null;
    landed = current >= total - 1;
    render();
  }

  function render() {
    follower.style.transform = `translate3d(${nudge.x}px, ${nudge.y}px, 0) rotate(${nudge.x * 0.3}deg)`;
    gaze.setAttribute("transform", `translate(${look.x} ${look.y})`);
    if (!falling) {
      fly.style.transform = "";
      return;
    }
    const pt = atLen(current);
    const p = clamp((pt.y - startY) / (endY - startY), 0, 1);
    const stretch = Math.min(Math.abs(target - current) / 900, 0.08);
    const scale = scaleAt(p, pt.x);
    fly.style.transform =
      `translate3d(${pt.x - origin.x}px, ${pt.y - origin.y}px, 0) rotate(${bank}deg) ` +
      `scale(${scale * (1 - stretch / 2)}, ${scale * (1 + stretch)})`;
    reveal.style.strokeDasharray = `${current} ${total + 10}`;
    if (!landed && current > total - 2) {
      landed = true;
      lander.classList.remove("landing");
      void lander.offsetWidth; // restart the squash animation
      lander.classList.add("landing");
    } else if (landed && current < total * 0.97) landed = false;
  }

  function tick(_time: number, dtMs: number) {
    const dt = clamp(dtMs / 1000, 0.001, 0.05);
    const glide = 1 - Math.exp(-dt * 3.5);
    const soft = 1 - Math.exp(-dt * 5);
    current += (target - current) * glide;
    if (Math.abs(target - current) < 0.3) current = target;
    // Bank into the turns the way a glider would.
    const x = atLen(current).x;
    const vx = prevX === null ? 0 : (x - prevX) / dt;
    prevX = x;
    bank += (clamp(vx * 0.012, -16, 16) - bank) * soft;
    if (Math.abs(bank) < 0.02) bank = 0;
    let nx = 0;
    let ny = 0;
    let lx = 0;
    let ly = 0;
    if (following && pointer.on) {
      const r = lander.getBoundingClientRect();
      const dx = pointer.x - (r.left + r.width / 2);
      const dy = pointer.y - (r.top + r.height / 2);
      const dist = Math.hypot(dx, dy) || 1;
      const reach = Math.min(dist * 0.06, 22);
      const eyes = Math.min(dist / 140, 1) * 5;
      nx = (dx / dist) * reach;
      ny = (dy / dist) * reach;
      lx = (dx / dist) * eyes;
      ly = (dy / dist) * eyes * 0.7;
      checkHover();
    }
    nudge.x += (nx - nudge.x) * soft;
    nudge.y += (ny - nudge.y) * soft;
    look.x += (lx - look.x) * soft;
    look.y += (ly - look.y) * soft;
    render();
    const settled =
      current === target &&
      bank === 0 &&
      Math.abs(nx - nudge.x) < 0.05 &&
      Math.abs(ny - nudge.y) < 0.05 &&
      Math.abs(lx - look.x) < 0.02 &&
      Math.abs(ly - look.y) < 0.02;
    if (settled) {
      gsap.ticker.remove(tick);
      running = false;
    }
  }
  const kick = () => {
    if (!running) {
      running = true;
      gsap.ticker.add(tick);
    }
  };

  /* Mouth: one shape redrawn from a few numbers, so every expression blends into the next. */
  const mouth = { ...FACES.grin };
  let face: Face = "grin";
  let idle: gsap.core.Animation | null = null;
  const drawMouth = () => {
    const { d, tongue: t } = mouthShape(mouth);
    mouthPath.setAttribute("d", d);
    mouthClip.setAttribute("d", d);
    tongue.setAttribute("cy", String(t.cy));
    tongue.setAttribute("rx", String(t.rx));
    tongue.setAttribute("ry", String(t.ry));
    tongue.setAttribute("opacity", String(t.opacity));
  };
  const setFace = (name: Face, duration = 0.28) => {
    face = name;
    gsap.to(mouth, {
      ...FACES[name],
      duration,
      ease: "power2.out",
      overwrite: true,
      onUpdate: drawMouth,
    });
  };
  const schedule = () => {
    idle = gsap.delayedCall(1.1 + Math.random() * 2.6, nextFace);
  };
  function nextFace() {
    if (hovering) return;
    if (Math.random() < 0.2) {
      // a little chatter
      const chatter = gsap.timeline({ onComplete: schedule });
      for (let i = 3 + Math.floor(Math.random() * 3); i > 0; i--)
        chatter.to(mouth, {
          w: 12 + Math.random() * 5,
          h: 5 + Math.random() * 18,
          tilt: 0,
          bulge: 0,
          duration: 0.11,
          ease: "sine.inOut",
          onUpdate: drawMouth,
        });
      chatter.to(mouth, { ...FACES.grin, duration: 0.2, onUpdate: drawMouth });
      idle = chatter;
      face = "grin";
      return;
    }
    setFace(pickMood(face));
    schedule();
  }
  const stopIdle = () => {
    idle?.kill();
    idle = null;
  };
  function checkHover() {
    const r = lander.getBoundingClientRect();
    const cx = r.left + ((138 - 50) / 176) * r.width;
    const cy = r.top + ((156 - 22) / 216) * r.height;
    const over =
      pointer.on &&
      Math.hypot(pointer.x - cx, pointer.y - cy) < (84 / 176) * r.width;
    if (over === hovering) return;
    hovering = over;
    stopIdle();
    if (over) setFace("wow", 0.18);
    else {
      setFace("grin");
      schedule();
    }
  }
  function applyMouthMode() {
    stopIdle();
    hovering = false;
    if (motionQuery.matches) schedule();
    else {
      gsap.killTweensOf(mouth);
      Object.assign(mouth, FACES.grin);
      drawMouth();
    }
  }

  function applyMode() {
    falling = fallQuery.matches;
    following = followQuery.matches;
    trail.style.display = falling ? "block" : "none";
    if (!following) pointer.on = false;
    layout();
    kick();
  }
  listen(
    window,
    "scroll",
    () => {
      if (!falling) return;
      target = lengthAtScroll(keys, scrollY, total);
      kick();
    },
    { passive: true },
  );
  listen(
    window,
    "pointermove",
    (e: PointerEvent) => {
      if (!following || e.pointerType !== "mouse") return;
      pointer.x = e.clientX;
      pointer.y = e.clientY;
      pointer.on = true;
      checkHover();
      kick();
    },
    { passive: true },
  );
  listen(document.documentElement, "pointerleave", () => {
    pointer.on = false;
    checkHover();
    kick();
  });
  listen(fallQuery, "change", applyMode);
  listen(followQuery, "change", applyMode);
  listen(motionQuery, "change", applyMouthMode);
  ScrollTrigger.addEventListener("refresh", layout); // pins change the page height
  document.fonts?.ready.then(() => ScrollTrigger.refresh());
  applyMode();
  applyMouthMode();

  return {
    dispose() {
      ScrollTrigger.removeEventListener("refresh", layout);
      gsap.ticker.remove(tick);
      stopIdle();
      gsap.killTweensOf(mouth);
      fly.style.transform = follower.style.transform = "";
    },
  };
}
