import { useEffect, useRef, useState } from 'react';
import { formatClock } from '../../data/rest-timer.ts';

interface RestDialProps {
  readonly remainingSeconds: number;
  readonly overdueSeconds: number;
  readonly finished: boolean;
  readonly progress: number; // 0..1 remaining fraction
  readonly onAdd: () => void;
  readonly onSubtract: () => void;
  readonly onDismiss: () => void;
}

// Rendered dimensions — 15% smaller than the design's 219 × 213 px.
const W = 181;
const H = Math.round(W * 213 / 219); // 176
const SC = W / 219; // scale from SVG coords to rendered pixels
const SNAP_MARGIN = 16;
const TAB_BAR_H = 112;

// All 90 tick-mark paths from design/Timer.svg, clockwise from 12 o'clock.
const TICK_PATHS = [
  'M106.168 11.231V23.231',
  'M112.795 11.4624L111.958 23.4332',
  'M119.39 12.1553L117.72 24.0385',
  'M125.92 13.3066L123.425 25.0444',
  'M132.354 14.9111L129.046 26.4463',
  'M138.66 16.96L134.556 28.2363',
  'M144.808 19.4438L139.928 30.4064',
  'M150.768 22.3511L145.135 32.9464',
  'M156.511 25.666L150.152 35.8426',
  'M162.009 29.374L154.955 39.0822',
  'M167.234 33.4565L159.52 42.6491',
  'M172.162 37.8931L163.826 46.5251',
  'M176.768 42.6636L167.85 50.6931',
  'M181.031 47.7432L171.574 55.1311',
  'M184.928 53.1074L174.98 59.8177',
  'M188.442 58.731L178.05 64.731',
  'M191.555 64.5859L180.77 69.8464',
  'M194.252 70.6436L183.126 75.1388',
  'M196.52 76.875L185.108 80.5832',
  'M198.348 83.2485L186.705 86.1516',
  'M199.727 89.7349L187.909 91.8186',
  'M200.65 96.3013L188.716 97.5556',
  'M201.113 102.917L189.12 103.335',
  'M201.113 109.547L189.12 109.128',
  'M200.65 116.162L188.716 114.908',
  'M199.727 122.729L187.91 120.645',
  'M198.349 129.215L186.705 126.312',
  'M196.521 135.589L185.108 131.881',
  'M194.253 141.82L183.127 137.325',
  'M191.556 147.878L180.771 142.617',
  'M188.443 153.733L178.051 147.733',
  'M184.93 159.356L174.981 152.646',
  'M181.032 164.721L171.576 157.333',
  'M176.77 169.8L167.852 161.771',
  'M172.163 174.571L163.828 165.939',
  'M167.236 179.008L159.522 169.815',
  'M162.01 183.09L154.957 173.382',
  'M156.513 186.798L150.154 176.622',
  'M150.77 190.114L145.137 179.518',
  'M144.81 193.021L139.93 182.059',
  'M138.662 195.505L134.558 184.229',
  'M132.356 197.554L129.048 186.019',
  'M125.922 199.159L123.427 187.421',
  'M119.392 200.31L117.722 188.427',
  'M112.797 201.003L111.96 189.033',
  'M106.17 201.235L106.17 189.235',
  'M99.543 201.003L100.38 189.033',
  'M92.9482 200.311L94.6183 188.427',
  'M86.4181 199.159L88.913 187.421',
  'M79.9839 197.555L83.2915 186.02',
  'M73.6774 195.506L77.7816 184.23',
  'M67.5292 193.022L72.41 182.06',
  'M61.5692 190.115L67.2029 179.52',
  'M55.8264 186.8L62.1855 176.623',
  'M50.3289 183.092L57.3823 173.384',
  'M45.1034 179.01L52.8169 169.817',
  'M40.1754 174.573L48.5113 165.941',
  'M35.5691 169.803L44.4868 161.773',
  'M31.3066 164.723L40.7628 157.335',
  'M27.4089 159.358L37.3574 152.648',
  'M23.8949 153.735L34.2872 147.735',
  'M20.7817 147.88L31.5673 142.62',
  'M18.0845 141.823L29.2107 137.327',
  'M15.8165 135.591L27.2292 131.883',
  'M13.9886 129.217L25.6322 126.314',
  'M12.6099 122.731L24.4276 120.647',
  'M11.687 116.165L23.6213 114.91',
  'M11.2244 109.55L23.2171 109.131',
  'M11.2241 102.919L23.2168 103.338',
  'M11.6865 96.3037L23.6208 97.5581',
  'M12.6091 89.7373L24.4268 91.8211',
  'M13.9877 83.2505L25.6312 86.1536',
  'M15.8153 76.877L27.228 80.5852',
  'M18.083 70.6455L29.2092 75.1408',
  'M20.78 64.5879L31.5656 69.8484',
  'M23.8931 58.7324L34.2854 64.7324',
  'M27.4067 53.1094L37.3552 59.8197',
  'M31.3044 47.7446L40.7606 55.1326',
  'M35.5667 42.665L44.4844 50.6946',
  'M40.173 37.8945L48.5089 46.5266',
  'M45.1007 33.4575L52.8142 42.6501',
  'M50.3259 29.3745L57.3794 39.0827',
  'M55.8234 25.6665L62.1824 35.8431',
  'M61.566 22.3511L67.1997 32.9465',
  'M67.526 19.4438L72.4068 30.4064',
  'M73.6742 16.96L77.7784 28.2363',
  'M79.9807 14.9106L83.2884 26.4458',
  'M86.4149 13.3062L88.9099 25.0439',
  'M92.9451 12.1543L94.6151 24.0375',
  'M99.5398 11.4614L100.377 23.4322',
];

type Pos = { x: number; y: number };
type Side = 'left' | 'right' | 'top' | 'bottom';

// Survives unmount so the next appearance enters from the same side it left.
let lastExitSide: Side = 'bottom';

function snap(x: number, y: number, vw: number, vh: number): Pos {
  const cx = x + W / 2 < vw / 2 ? SNAP_MARGIN : vw - W - SNAP_MARGIN;
  const cy = y + H / 2 < vh / 2 ? SNAP_MARGIN : vh - H - TAB_BAR_H;
  return { x: cx, y: cy };
}

function nearestSide(pos: Pos, vw: number, vh: number): Side {
  const cx = pos.x + W / 2;
  const cy = pos.y + H / 2;
  const d = { left: cx, right: vw - cx, top: cy, bottom: vh - cy };
  return (Object.keys(d) as Side[]).reduce((a, b) => d[a] < d[b] ? a : b);
}

function offscreen(pos: Pos, side: Side, vw: number, vh: number): Pos {
  switch (side) {
    case 'left':   return { x: -(W + 20), y: pos.y };
    case 'right':  return { x: vw + 20, y: pos.y };
    case 'top':    return { x: pos.x, y: -(H + 20) };
    case 'bottom': return { x: pos.x, y: vh + 20 };
  }
}

function entryPos(vw: number, vh: number): Pos {
  const target = snap(vw - W - SNAP_MARGIN, vh - H - TAB_BAR_H, vw, vh);
  return offscreen(target, lastExitSide, vw, vh);
}

function playDing() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.4, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.6);
  } catch (_) { /* no audio support */ }
}

// Floating rest timer — drags freely, snaps to corners, slides in/out from nearest edge.
export function RestDial(props: RestDialProps) {
  const [pos, setPos] = useState<Pos>(() =>
    entryPos(window.innerWidth, window.innerHeight)
  );
  const [dragging, setDragging] = useState(false);
  const draggingRef = useRef(false); // always-current mirror of dragging for pointer handlers
  const dragOffset = useRef({ dx: 0, dy: 0 });
  const didDing = useRef(false);
  const posRef = useRef(pos);
  useEffect(() => { posRef.current = pos; }, [pos]);

  // Slide in on mount.
  useEffect(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    setPos(snap(vw - W - SNAP_MARGIN, vh - H - TAB_BAR_H, vw, vh));
  }, []);

  // On finish: play ding, slide off to nearest edge, then dismiss.
  useEffect(() => {
    if (props.finished) {
      if (!didDing.current) { playDing(); didDing.current = true; }
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const side = nearestSide(posRef.current, vw, vh);
      lastExitSide = side;
      setPos(offscreen(posRef.current, side, vw, vh));
      const t = window.setTimeout(props.onDismiss, 350);
      return () => window.clearTimeout(t);
    } else {
      didDing.current = false;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.finished]);

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as Element).closest('[data-btn]')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    draggingRef.current = true;
    setDragging(true);
    dragOffset.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    setPos({
      x: Math.max(0, Math.min(window.innerWidth - W, e.clientX - dragOffset.current.dx)),
      y: Math.max(0, Math.min(window.innerHeight - H, e.clientY - dragOffset.current.dy)),
    });
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setDragging(false);
    setPos(snap(
      e.clientX - dragOffset.current.dx,
      e.clientY - dragOffset.current.dy,
      window.innerWidth, window.innerHeight,
    ));
  };

  const litTicks = Math.round(props.progress * TICK_PATHS.length);

  // Map SVG coordinates to rendered pixels for tap-target positioning.
  const px = (svgX: number) => Math.round(svgX * SC);
  const py = (svgY: number) => Math.round(svgY * SC);

  return (
    <div
      data-testid="rest-timer"
      className="fixed z-50 touch-none select-none"
      style={{
        left: pos.x,
        top: pos.y,
        width: W,
        height: H,
        cursor: dragging ? 'grabbing' : 'grab',
        transition: dragging ? 'none' : 'left 0.3s ease, top 0.3s ease',
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {/* SVG matches design/Timer.svg — viewBox 219 × 213 */}
      <svg
        width={W}
        height={H}
        viewBox="0 0 219 213"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden
      >
        <circle cx="106.168" cy="106.231" r="100" fill="black" stroke="#FF1C00" strokeWidth="2" />

        {TICK_PATHS.map((d, i) => (
          <path
            key={i}
            d={d}
            stroke="#FF1C00"
            strokeOpacity={props.finished || i < litTicks ? 1 : 0.4}
            strokeWidth="2"
          />
        ))}

        {/* + symbol at top */}
        <path
          d="M104.464 62.007V57.655H99.12V53.527H104.464V49.175H108.784V53.527H114.128V57.655H108.784V62.007H104.464Z"
          fill="#FF1C00"
        />
        {/* − symbol at bottom */}
        <path
          d="M100.608 160.311V155.863H113.216V160.311H100.608Z"
          fill="#FF1C00"
        />

        <text
          x="106.168"
          y="106.231"
          textAnchor="middle"
          dominantBaseline="central"
          fontFamily="'Special Gothic Expanded One', sans-serif"
          fontSize="28"
          fill={props.finished ? '#FF1C00' : '#E6E6E6'}
        >
          {props.finished
            ? `+${formatClock(props.overdueSeconds)}`
            : formatClock(props.remainingSeconds)}
        </text>

        {/* Close button — exact from design: black clearing circle, red-bordered inner circle, white X */}
        <circle cx="181.168" cy="165.231" r="37" fill="black" />
        <circle cx="181.168" cy="165.231" r="31" fill="black" stroke="#FF1C00" strokeWidth="2" />
        <path d="M173.418 157.481L189.418 173.481" stroke="white" strokeWidth="2" strokeLinecap="round" />
        <path d="M189.418 157.481L173.418 173.481" stroke="white" strokeWidth="2" strokeLinecap="round" />
      </svg>

      {/* Invisible tap targets over the SVG hit areas */}
      <button
        type="button"
        data-btn=""
        aria-label="Add 15 seconds"
        data-testid="rest-add"
        onClick={props.onAdd}
        className="absolute opacity-0"
        style={{ left: px(106.168) - 28, top: py(55) - 28, width: 56, height: 56 }}
      />
      <button
        type="button"
        data-btn=""
        aria-label="Subtract 15 seconds"
        data-testid="rest-subtract"
        onClick={props.onSubtract}
        className="absolute opacity-0"
        style={{ left: px(106.168) - 28, top: py(158) - 28, width: 56, height: 56 }}
      />
      <button
        type="button"
        data-btn=""
        aria-label="Dismiss timer"
        data-testid="dismiss-timer"
        onClick={props.onDismiss}
        className="absolute rounded-full opacity-0"
        style={{
          left: px(181.168) - px(37),
          top: py(165.231) - py(37),
          width: px(74),
          height: px(74),
        }}
      />
    </div>
  );
}
