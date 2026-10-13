// The Yuzu logo character (public/logo.svg) drawn inline so its parts can move.
// The ids are what components/welcome/motion.ts animates.

const MOUTH =
  "M120 162 L156 162 C156 178 148 190 138 190 C128 190 120 178 120 162 Z";
const LEAF_SMALL = "M140 80 C122 78 104 68 98 52 C118 46 136 54 144 74 Z";
const LEAF_BIG =
  "M140 80 C136 50 154 30 182 28 C198 26 212 26 222 28 C214 52 198 68 176 74 C160 78 148 80 140 80 Z";
const LEAF_VEIN = "M144 76 C158 52 180 40 214 32";
const FRECKLES = [
  [88, 164, 2.6],
  [98, 170, 2.2],
  [86, 175, 2.2],
  [96, 180, 2],
  [188, 164, 2.6],
  [178, 170, 2.2],
  [190, 175, 2.2],
  [180, 180, 2],
];

function Gradients({ prefix }: { prefix: string }) {
  return (
    <>
      <radialGradient id={`${prefix}-body`} cx="52%" cy="30%" r="80%">
        <stop offset="0%" stopColor="#FFEF63" />
        <stop offset="45%" stopColor="#FFD83A" />
        <stop offset="100%" stopColor="#FB9A12" />
      </radialGradient>
      <linearGradient id={`${prefix}-leaf-big`} x1="0" y1="1" x2="1" y2="0">
        <stop offset="0%" stopColor="#0B5E57" />
        <stop offset="55%" stopColor="#17917A" />
        <stop offset="100%" stopColor="#6CCB6B" />
      </linearGradient>
      <linearGradient id={`${prefix}-leaf-small`} x1="1" y1="1" x2="0" y2="0">
        <stop offset="0%" stopColor="#0E8070" />
        <stop offset="100%" stopColor="#A6DE6B" />
      </linearGradient>
    </>
  );
}

function Freckles() {
  return (
    <g fill="#D9731A" opacity="0.5">
      {FRECKLES.map(([cx, cy, r]) => (
        <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={r} />
      ))}
    </g>
  );
}

function Eye({ x, className }: { x: number; className: string }) {
  return (
    <g transform={`translate(${x} 140)`}>
      <g className={className}>
        <ellipse rx="9" ry="14" fill="#1E2340" />
        <ellipse cx="-2" cy="-5" rx="2.6" ry="4.2" fill="#FFFFFF" />
      </g>
    </g>
  );
}

/** The hero mascot: idle animation comes from CSS; mouth and gaze are driven by script. */
export function HeroMascot() {
  return (
    <svg
      className="mascot"
      viewBox="50 22 176 216"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <Gradients prefix="hm" />
        <clipPath id="hm-mouth-clip">
          <path id="hmMouthClip" d={MOUTH} />
        </clipPath>
      </defs>
      <g className="hm-fruit">
        <path
          className="hm-leaf-small"
          d={LEAF_SMALL}
          fill="url(#hm-leaf-small)"
        />
        <g className="hm-leaf-big">
          <path d={LEAF_BIG} fill="url(#hm-leaf-big)" />
          <path
            d={LEAF_VEIN}
            fill="none"
            stroke="#9BE39A"
            strokeWidth="2.5"
            strokeLinecap="round"
            opacity="0.45"
          />
        </g>
        <ellipse cx="138" cy="156" rx="84" ry="80" fill="url(#hm-body)" />
        <Freckles />
        <g id="hmGaze">
          <Eye x={111} className="hm-eye" />
          <Eye x={165} className="hm-eye" />
        </g>
        <g className="hm-mouth">
          <path
            id="hmMouth"
            d={MOUTH}
            fill="#1E2340"
            stroke="#1E2340"
            strokeWidth="4"
            strokeLinejoin="round"
          />
          <ellipse
            id="hmTongue"
            cx="138"
            cy="188"
            rx="11"
            ry="8"
            fill="#FF7A8A"
            clipPath="url(#hm-mouth-clip)"
          />
        </g>
      </g>
    </svg>
  );
}

/** The splash's yuzu: leaves and eyes are animated by the splash timeline. */
export function SplashFruit() {
  return (
    <svg
      viewBox="50 22 176 216"
      overflow="visible"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <Gradients prefix="sp" />
        <clipPath id="sp-mouth-clip">
          <path d={MOUTH} />
        </clipPath>
      </defs>
      <g id="spLeaves">
        <path d={LEAF_SMALL} fill="url(#sp-leaf-small)" />
        <path d={LEAF_BIG} fill="url(#sp-leaf-big)" />
        <path
          d={LEAF_VEIN}
          fill="none"
          stroke="#9BE39A"
          strokeWidth="2.5"
          strokeLinecap="round"
          opacity="0.45"
        />
      </g>
      <ellipse cx="138" cy="156" rx="84" ry="80" fill="url(#sp-body)" />
      <Freckles />
      <Eye x={111} className="sp-eye" />
      <Eye x={165} className="sp-eye" />
      <path
        d={MOUTH}
        fill="#1E2340"
        stroke="#1E2340"
        strokeWidth="4"
        strokeLinejoin="round"
      />
      <ellipse
        cx="138"
        cy="188"
        rx="11"
        ry="8"
        fill="#FF7A8A"
        clipPath="url(#sp-mouth-clip)"
      />
    </svg>
  );
}
