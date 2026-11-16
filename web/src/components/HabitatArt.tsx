import type { ReactNode } from "react";

/**
 * Shaded illustrations for the habitat choices on the Rank page. Drawn in SVG
 * with gradients for depth, so there are no image files to load. They are
 * decoration: the label next to each one names the habitat.
 */

const W = 120;
const H = 84;

function Frame({ id, sky, children }: { id: string; sky: [string, string]; children: ReactNode }) {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} aria-hidden="true" className="block h-auto w-full">
      <defs>
        <linearGradient id={`${id}-sky`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={sky[0]} />
          <stop offset="1" stopColor={sky[1]} />
        </linearGradient>
        {/* Lit from the upper left. */}
        <radialGradient id={`${id}-white`} cx="0.35" cy="0.3" r="0.8">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.55" stopColor="#d9dfe8" />
          <stop offset="1" stopColor="#8d98aa" />
        </radialGradient>
        <linearGradient id={`${id}-metal`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f4f6f9" />
          <stop offset="0.5" stopColor="#c5ccd8" />
          <stop offset="1" stopColor="#7f8a9c" />
        </linearGradient>
        <linearGradient id={`${id}-glass`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#bfe1ff" />
          <stop offset="1" stopColor="#2f6fc0" />
        </linearGradient>
        <radialGradient id={`${id}-moon`} cx="0.4" cy="0.1" r="1">
          <stop offset="0" stopColor="#d5d8de" />
          <stop offset="1" stopColor="#7c828d" />
        </radialGradient>
        <radialGradient id={`${id}-mars`} cx="0.4" cy="0.1" r="1">
          <stop offset="0" stopColor="#e39a6a" />
          <stop offset="1" stopColor="#9a4a2a" />
        </radialGradient>
        <clipPath id={`${id}-clip`}>
          <rect width={W} height={H} rx="8" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${id}-clip)`}>
        <rect width={W} height={H} fill={`url(#${id}-sky)`} />
        {children}
      </g>
    </svg>
  );
}

const SPACE: [string, string] = ["#0b1430", "#1b2f66"];

function Stars() {
  const stars = [
    [10, 9, 0.8], [26, 20, 0.6], [44, 7, 0.7], [70, 12, 0.9], [92, 6, 0.6], [108, 18, 0.8], [58, 24, 0.5], [16, 34, 0.5], [100, 36, 0.6],
  ];
  return (
    <g fill="#ffffff" opacity="0.85">
      {stars.map(([cx, cy, r]) => (
        <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={r} />
      ))}
    </g>
  );
}

function Ground({ fill, craters }: { fill: string; craters: string }) {
  return (
    <g>
      <ellipse cx={W / 2} cy={H + 14} rx={W * 0.78} ry={38} fill={fill} />
      <ellipse cx={22} cy={73} rx={7} ry={2} fill={craters} opacity="0.5" />
      <ellipse cx={98} cy={76} rx={9} ry={2.4} fill={craters} opacity="0.5" />
      <ellipse cx={74} cy={80} rx={4} ry={1.2} fill={craters} opacity="0.5" />
    </g>
  );
}

/** A dome on the ground with a soft shadow, an airlock, and a row of windows. */
function Dome({ id, cx, base, r }: { id: string; cx: number; base: number; r: number }) {
  return (
    <g>
      <ellipse cx={cx + r * 0.25} cy={base + 1.5} rx={r * 1.15} ry={r * 0.16} fill="#000000" opacity="0.28" />
      <path d={`M${cx - r} ${base} A${r} ${r} 0 0 1 ${cx + r} ${base} Z`} fill={`url(#${id}-white)`} />
      <path
        d={`M${cx - r * 0.72} ${base - r * 0.38} A${r} ${r * 0.5} 0 0 1 ${cx + r * 0.72} ${base - r * 0.38}`}
        fill="none"
        stroke="#7f8a9c"
        strokeWidth="0.6"
        opacity="0.7"
      />
      {[-0.42, -0.14, 0.14, 0.42].map((offset) => (
        <rect
          key={offset}
          x={cx + offset * r - r * 0.08}
          y={base - r * 0.3}
          width={r * 0.16}
          height={r * 0.14}
          rx="0.8"
          fill={`url(#${id}-glass)`}
        />
      ))}
      <rect x={cx - r * 0.13} y={base - r * 0.13} width={r * 0.26} height={r * 0.13} fill="#5b6577" />
    </g>
  );
}

function Iss({ id }: { id: string }) {
  const panel = (x: number) => (
    <g key={x}>
      <path d={`M${x} 22 l16 -4 v38 l-16 4 Z`} fill={`url(#${id}-glass)`} />
      <path d={`M${x} 22 l16 -4 v38 l-16 4 Z`} fill="none" stroke="#0d366b" strokeWidth="0.6" />
      {[30, 38, 46, 54].map((y) => (
        <path key={y} d={`M${x} ${y} l16 -4`} stroke="#0d366b" strokeWidth="0.4" opacity="0.7" />
      ))}
    </g>
  );
  return (
    <Frame id={id} sky={SPACE}>
      <Stars />
      {/* Earth's limb */}
      <ellipse cx={60} cy={112} rx={90} ry={36} fill="#2f6fc0" opacity="0.55" />
      <ellipse cx={60} cy={114} rx={90} ry={36} fill="#1b3a8c" />
      {[8, 28, 76, 96].map(panel)}
      {/* truss */}
      <rect x={6} y={38} width={108} height={4} rx="1" fill={`url(#${id}-metal)`} />
      {/* modules: cylinders seen from the side */}
      <rect x={48} y={30} width={24} height={20} rx="6" fill={`url(#${id}-metal)`} />
      <ellipse cx={72} cy={40} rx={3} ry={10} fill="#a9b2c1" />
      <rect x={54} y={48} width={12} height={18} rx="4" fill={`url(#${id}-metal)`} />
      <rect x={55} y={16} width={10} height={16} rx="4" fill={`url(#${id}-metal)`} />
      <circle cx={57} cy={38} r={1.6} fill={`url(#${id}-glass)`} />
      <circle cx={63} cy={38} r={1.6} fill={`url(#${id}-glass)`} />
    </Frame>
  );
}

function MoonBase({ id }: { id: string }) {
  return (
    <Frame id={id} sky={SPACE}>
      <Stars />
      <circle cx={98} cy={16} r={7} fill="#2f6fc0" />
      <path d="M93 13 a7 7 0 0 1 10 -2 a9 9 0 0 0 -10 2" fill="#bfe1ff" opacity="0.7" />
      <Ground fill={`url(#${id}-moon)`} craters="#565c66" />
      <Dome id={id} cx={56} base={68} r={26} />
      <path d="M90 68 v-16 M86 54 h8" stroke="#c5ccd8" strokeWidth="1.2" strokeLinecap="round" />
    </Frame>
  );
}

function Rover({ id }: { id: string }) {
  return (
    <Frame id={id} sky={SPACE}>
      <Stars />
      <Ground fill={`url(#${id}-moon)`} craters="#565c66" />
      <ellipse cx={62} cy={73} rx={40} ry={4} fill="#000000" opacity="0.28" />
      {/* cabin: front face, lighter top face, darker side face */}
      <path d="M30 40 l10 -8 h44 l8 8 Z" fill="#f4f6f9" />
      <rect x={30} y={40} width={62} height={20} rx="3" fill={`url(#${id}-metal)`} />
      <path d="M92 40 l8 6 v14 l-8 0 Z" fill="#7f8a9c" />
      <rect x={36} y={43} width={22} height={10} rx="2" fill={`url(#${id}-glass)`} />
      <rect x={62} y={43} width={10} height={10} rx="2" fill={`url(#${id}-glass)`} />
      <rect x={76} y={43} width={10} height={10} rx="2" fill={`url(#${id}-glass)`} />
      <path d="M78 32 v-9 M73 23 h10" stroke="#c5ccd8" strokeWidth="1.2" strokeLinecap="round" />
      {[38, 62, 86].map((cx) => (
        <g key={cx}>
          <circle cx={cx} cy={66} r={8} fill="#2a303b" />
          <circle cx={cx} cy={66} r={4} fill="#8d98aa" />
          <circle cx={cx - 1.2} cy={64.8} r={1.4} fill="#e6eaf0" />
        </g>
      ))}
    </Frame>
  );
}

function MoonBaseLarge({ id }: { id: string }) {
  return (
    <Frame id={id} sky={SPACE}>
      <Stars />
      <Ground fill={`url(#${id}-moon)`} craters="#565c66" />
      {/* connecting tunnel behind the domes */}
      <rect x={40} y={58} width={44} height={8} rx="4" fill={`url(#${id}-metal)`} />
      <Dome id={id} cx={34} base={68} r={20} />
      <Dome id={id} cx={86} base={70} r={24} />
      {/* storage tank: a cylinder with a lit top */}
      <rect x={54} y={46} width={12} height={16} fill={`url(#${id}-metal)`} />
      <ellipse cx={60} cy={46} rx={6} ry={2.2} fill="#f4f6f9" />
      <ellipse cx={60} cy={62} rx={6} ry={2.2} fill="#7f8a9c" />
    </Frame>
  );
}

function Spacesuit({ id }: { id: string }) {
  return (
    <Frame id={id} sky={SPACE}>
      <defs>
        <radialGradient id={`${id}-visor`} cx="0.3" cy="0.25" r="0.9">
          <stop offset="0" stopColor="#fff3c4" />
          <stop offset="0.45" stopColor="#e2a52a" />
          <stop offset="1" stopColor="#6b4706" />
        </radialGradient>
      </defs>
      <Stars />
      {/* backpack, then arms, torso and helmet in front of it */}
      <rect x={42} y={36} width={36} height={40} rx="5" fill="#9aa4b4" />
      <rect x={28} y={50} width={16} height={36} rx="8" fill={`url(#${id}-white)`} />
      <rect x={76} y={50} width={16} height={36} rx="8" fill={`url(#${id}-white)`} />
      <rect x={38} y={46} width={44} height={44} rx="10" fill={`url(#${id}-white)`} />
      <rect x={50} y={60} width={20} height={12} rx="2" fill="#c5ccd8" stroke="#7f8a9c" strokeWidth="0.6" />
      <circle cx={55} cy={66} r={1.8} fill="#d03b3b" />
      <circle cx={61} cy={66} r={1.8} fill="#2a78d6" />
      <rect x={47} y={43} width={26} height={6} rx="3" fill="#8d98aa" />
      <circle cx={60} cy={28} r={19} fill={`url(#${id}-white)`} />
      <ellipse cx={61} cy={29} rx={13} ry={11.5} fill={`url(#${id}-visor)`} />
      <ellipse cx={55} cy={23.5} rx={4.5} ry={2.4} fill="#ffffff" opacity="0.75" transform="rotate(-28 55 23.5)" />
    </Frame>
  );
}

function Mars({ id }: { id: string }) {
  return (
    <Frame id={id} sky={["#f1b48a", "#e08a5c"]}>
      <circle cx={98} cy={16} r={5} fill="#fff3d6" opacity="0.9" />
      <path d="M0 62 l22 -16 l16 10 l20 -14 l26 16 l36 -12 v40 h-120 Z" fill="#b4623a" opacity="0.75" />
      <Ground fill={`url(#${id}-mars)`} craters="#6f2f18" />
      <Dome id={id} cx={58} base={68} r={25} />
      {/* solar panel on a stand */}
      <path d="M92 62 l16 -6 v6 l-16 6 Z" fill={`url(#${id}-glass)`} stroke="#0d366b" strokeWidth="0.5" />
      <path d="M100 63 v8" stroke="#5b6577" strokeWidth="1.2" />
    </Frame>
  );
}

function Earth({ id }: { id: string }) {
  return (
    <Frame id={id} sky={SPACE}>
      <defs>
        <radialGradient id={`${id}-ocean`} cx="0.34" cy="0.3" r="0.85">
          <stop offset="0" stopColor="#7cc0ff" />
          <stop offset="0.55" stopColor="#2a78d6" />
          <stop offset="1" stopColor="#0d2a5c" />
        </radialGradient>
        <radialGradient id={`${id}-shade`} cx="0.34" cy="0.3" r="0.85">
          <stop offset="0.55" stopColor="#000000" stopOpacity="0" />
          <stop offset="1" stopColor="#000000" stopOpacity="0.55" />
        </radialGradient>
        <clipPath id={`${id}-globe`}>
          <circle cx={60} cy={42} r={30} />
        </clipPath>
      </defs>
      <Stars />
      <circle cx={60} cy={42} r={32.5} fill="#7cc0ff" opacity="0.22" />
      <circle cx={60} cy={42} r={30} fill={`url(#${id}-ocean)`} />
      <g clipPath={`url(#${id}-globe)`}>
        <path d="M38 24 q10 -8 20 -2 q6 6 -2 12 q-4 8 -12 6 q-10 -4 -6 -16 Z" fill="#2f9e5b" />
        <path d="M58 44 q10 -4 14 6 q2 12 -6 18 q-8 -2 -8 -12 Z" fill="#2f9e5b" />
        <path d="M74 22 q10 2 14 12 q-6 6 -14 0 q-4 -6 0 -12 Z" fill="#2f9e5b" />
        <path d="M30 46 q12 -4 22 2 M50 18 q14 4 30 0 M40 62 q16 -6 34 0" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" fill="none" opacity="0.6" />
        <circle cx={60} cy={42} r={30} fill={`url(#${id}-shade)`} />
      </g>
    </Frame>
  );
}

const ART: Record<string, (props: { id: string }) => ReactNode> = {
  iss: Iss,
  moon_base: MoonBase,
  rover: Rover,
  moon_base_upper_pressure: MoonBaseLarge,
  spacesuit: Spacesuit,
  mars_habitat: Mars,
  earth_sea_level: Earth,
};

/** The illustration for a Rank choice, or nothing if the choice has none. */
export function HabitatArt({ id }: { id: string }) {
  const Art = ART[id];
  return Art ? <Art id={`art-${id}`} /> : null;
}
