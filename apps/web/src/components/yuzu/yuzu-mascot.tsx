import "./yuzu-mascot.css";

export type YuzuMood =
  | "confused"
  | "sad"
  | "stern"
  | "sleepy"
  | "dizzy"
  | "builder"
  | "cold";

const INK = "#1E2340";
const eye = (x: number, y: number, rx = 10, ry = 15) => (
  <g transform={`translate(${x} ${y})`}>
    <g className="ym-blink">
      <ellipse rx={rx} ry={ry} fill={INK} />
      <ellipse cx={-2} cy={-5} rx={3} ry={4.6} fill="#fff" />
    </g>
  </g>
);
const stroke = {
  fill: "none",
  stroke: INK,
  strokeWidth: 5.5,
  strokeLinecap: "round" as const,
};

function Face({ mood }: { mood: YuzuMood }) {
  switch (mood) {
    case "confused":
      return (
        <>
          <path d="M96 128 Q110 114 126 124" {...stroke} />
          <path d="M152 132 L180 138" {...stroke} />
          {eye(111, 156)}
          {eye(166, 158, 7, 9.5)}
          <path d="M116 192 q7-9 14 0 t14 0 t14 0" {...stroke} />
        </>
      );
    case "sad":
      return (
        <>
          <path d="M94 138 L126 124" {...stroke} />
          <path d="M182 138 L150 124" {...stroke} />
          {eye(111, 160, 11)}
          {eye(165, 160, 11)}
          <path d="M122 204 Q138 190 154 204" {...stroke} />
          <path
            className="ym-tear"
            d="M100 178 C95 188 94 193 100 196 C106 193 105 188 100 178Z"
            fill="#6EC8F5"
          />
        </>
      );
    case "stern":
      return (
        <>
          <path d="M94 132 L128 142" {...stroke} />
          <path d="M182 132 L148 142" {...stroke} />
          {eye(111, 164, 10, 9)}
          {eye(165, 164, 10, 9)}
          <path d="M122 204 L154 204" {...stroke} />
        </>
      );
    case "sleepy":
      return (
        <>
          <path d="M97 162 Q111 174 125 162" {...stroke} />
          <path d="M151 162 Q165 174 179 162" {...stroke} />
          <ellipse cx="138" cy="203" rx="7" ry="9" fill={INK} />
        </>
      );
    case "dizzy":
      return (
        <>
          {[111, 165].map((x) => (
            <g key={x} transform={`translate(${x} 160)`}>
              <circle r="17" fill="#fff" />
              <g className="ym-spin">
                <path
                  d="M0 0a2 2 0 0 1 4 0a5 5 0 0 1-10 0a8 8 0 0 1 16 0a11 11 0 0 1-22 0"
                  fill="none"
                  stroke={INK}
                  strokeWidth="2.6"
                  strokeLinecap="round"
                />
              </g>
            </g>
          ))}
          <path d="M116 200 q7-9 14 0 t14 0 t14 0" {...stroke} />
        </>
      );
    case "builder":
      return (
        <>
          {eye(111, 166, 9, 14)}
          {eye(165, 166, 9, 14)}
          <path
            d="M120 190 L156 190 C156 206 148 218 138 218 C128 218 120 206 120 190Z"
            fill={INK}
            stroke={INK}
            strokeWidth="4"
            strokeLinejoin="round"
          />
          <path d="M60 118 C60 62 216 62 216 118Z" fill="#F2663B" />
          <rect x="48" y="112" width="180" height="16" rx="8" fill="#D94E27" />
          <path
            d="M122 70 C122 60 154 60 154 70 L154 112 L122 112Z"
            fill="#D94E27"
          />
        </>
      );
    case "cold":
      return (
        <>
          <path d="M96 134 Q110 122 126 130" {...stroke} />
          <path d="M180 134 Q166 122 150 130" {...stroke} />
          {[111, 165].map((x) => (
            <g key={x} transform={`translate(${x} 160)`}>
              <ellipse rx="15" ry="19" fill="#fff" />
              <ellipse rx="6" ry="8" fill={INK} />
            </g>
          ))}
          <path d="M120 206 q4-7 9 0 t9 0 t9 0 t9 0" {...stroke} />
        </>
      );
  }
}

export function YuzuMascot({
  mood,
  label,
  style,
}: {
  mood: YuzuMood;
  label?: string;
  style?: React.CSSProperties;
}) {
  const id = `ym-${mood}`;
  return (
    <svg
      className={`ym ym-${mood}`}
      style={style}
      viewBox="0 0 256 290"
      role="img"
      aria-label={label ?? `Yuzu looking ${mood}`}
    >
      <defs>
        <radialGradient id={`${id}-b`} cx="52%" cy="30%" r="80%">
          <stop offset="0%" stopColor="#FFEF63" />
          <stop offset="45%" stopColor="#FFD83A" />
          <stop offset="100%" stopColor="#FB9A12" />
        </radialGradient>
        <linearGradient id={`${id}-l`} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%" stopColor="#0B5E57" />
          <stop offset="55%" stopColor="#17917A" />
          <stop offset="100%" stopColor="#6CCB6B" />
        </linearGradient>
      </defs>
      <ellipse cx="138" cy="262" rx="72" ry="9" fill="#000" opacity=".18" />
      <g className="ym-char">
        {mood !== "builder" && (
          <g className="ym-leaves">
            <path
              d="M140 80C122 78 104 68 98 52C118 46 136 54 144 74Z"
              fill="#17917A"
            />
            <path
              d="M140 80C136 50 154 30 182 28C198 26 212 26 222 28C214 52 198 68 176 74C160 78 148 80 140 80Z"
              fill={`url(#${id}-l)`}
            />
          </g>
        )}
        <ellipse cx="138" cy="170" rx="84" ry="80" fill={`url(#${id}-b)`} />
        <g fill="#D9731A" opacity=".5">
          <circle cx="88" cy="184" r="2.6" />
          <circle cx="98" cy="190" r="2.2" />
          <circle cx="188" cy="184" r="2.6" />
          <circle cx="178" cy="190" r="2.2" />
        </g>
        <Face mood={mood} />
      </g>
      {mood === "confused" && (
        <g fill="currentColor" fontFamily="inherit" fontWeight="800">
          <text className="ym-float" x="214" y="92" fontSize="44">
            ?
          </text>
          <text className="ym-float ym-d2" x="22" y="76" fontSize="34">
            ?
          </text>
        </g>
      )}
      {mood === "sleepy" && (
        <g fill="currentColor" fontWeight="800">
          <text className="ym-float" x="196" y="86" fontSize="40">
            Z
          </text>
          <text className="ym-float ym-d2" x="214" y="62" fontSize="30">
            z
          </text>
          <text className="ym-float ym-d3" x="226" y="42" fontSize="22">
            z
          </text>
        </g>
      )}
      {mood === "dizzy" && (
        <g
          className="ym-orbit"
          fill="#FFD83A"
          stroke="#FB9A12"
          strokeWidth="1.5"
          strokeLinejoin="round"
        >
          <path d="M138 8l4 9 10 1-8 6 3 10-9-6-9 6 3-10-8-6 10-1z" />
          <path d="M188 66l3 7 8 1-6 5 2 8-7-5-7 5 2-8-6-5 8-1z" />
          <path d="M88 66l3 7 8 1-6 5 2 8-7-5-7 5 2-8-6-5 8-1z" />
        </g>
      )}
      {mood === "stern" && (
        <g className="ym-lock" transform="translate(166 196)">
          <path
            d="M14 22V14C14 -4 46 -4 46 14V22"
            fill="none"
            stroke="#B7CFCA"
            strokeWidth="8"
            strokeLinecap="round"
          />
          <rect y="20" width="60" height="50" rx="12" fill="#2F6F6A" />
          <circle cx="30" cy="42" r="6" fill="#FFD83A" />
          <rect x="27.5" y="44" width="5" height="14" rx="2.5" fill="#FFD83A" />
        </g>
      )}
      {mood === "builder" && (
        <g className="ym-wrench" fill="#5B7A75">
          <rect x="205" y="168" width="14" height="70" rx="7" />
          <path d="M196 170a22 22 0 1 1 32 0l-8-8h-16z" />
        </g>
      )}
      {mood === "cold" && (
        <g
          transform="translate(138 28)"
          fill="none"
          stroke="#2F8DBB"
          strokeWidth="7"
          strokeLinecap="round"
        >
          <path className="ym-wave" d="M-40-2a56 56 0 0 1 80 0" />
          <path className="ym-wave" d="M-26 12a36 36 0 0 1 52 0" />
          <path className="ym-wave" d="M-12 26a16 16 0 0 1 24 0" />
          <path d="M-34 52L34-12" stroke="#D94E27" />
        </g>
      )}
    </svg>
  );
}
