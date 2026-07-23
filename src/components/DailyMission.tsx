// ─────────────────────────────────────────────────────────────────────────────
// Today's Mission — one objective, rendered as a constellation.
//
// Each business is a node. As you finish them, the nodes light gold and the lines
// between them connect — progress feels like lighting a constellation, not filling a
// bar. Restrained and elegant; the geometry never competes with the words.
// ─────────────────────────────────────────────────────────────────────────────
import { Target, CheckCircle2 } from "lucide-react";
import type { DailyMission as Mission } from "@/lib/work-queue";
import { minutesLabel } from "@/lib/work-queue";

// Gentle vertical variance so the nodes read as a constellation, not a ruler.
const YS = [22, 13, 27, 16, 24, 12, 26, 18, 23, 14, 25, 17];

function ConstellationProgress({ total, done }: { total: number; done: number }) {
  const n = Math.max(1, Math.min(total, 12));
  const lit = total > 0 ? Math.round((done / total) * n) : 0;
  const W = 320, H = 40, pad = 12;
  const step = n > 1 ? (W - 2 * pad) / (n - 1) : 0;
  const pts = Array.from({ length: n }, (_, k) => ({ x: pad + k * step, y: YS[k % YS.length], on: k < lit }));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 40 }} role="img" aria-label={`${done} of ${total} complete`}>
      {/* connecting paths — lit gold once both ends are on */}
      {pts.slice(1).map((p, k) => {
        const a = pts[k], both = a.on && p.on;
        return <line key={k} x1={a.x} y1={a.y} x2={p.x} y2={p.y} stroke={both ? "#E8A24A" : "#FFFFFF"} strokeOpacity={both ? 0.5 : 0.08} strokeWidth={both ? 1.2 : 1} />;
      })}
      {/* nodes — gold + halo when lit, quiet steel otherwise */}
      {pts.map((p, k) => (
        <g key={k}>
          {p.on && <circle cx={p.x} cy={p.y} r={5.5} fill="#F5BC63" opacity={0.18} />}
          <circle cx={p.x} cy={p.y} r={p.on ? 3 : 2} fill={p.on ? "#F6CD88" : "#5B6472"} opacity={p.on ? 1 : 0.7} />
        </g>
      ))}
    </svg>
  );
}

export function DailyMission({ mission }: { mission: Mission }) {
  const { total, done, remaining, estMinutes } = mission;
  if (total === 0) return null;
  const complete = remaining === 0;

  return (
    <section className="card relative overflow-hidden p-5">
      {/* faint constellation wash behind the card — barely there */}
      <svg viewBox="0 0 400 120" className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.06]" preserveAspectRatio="xMidYMid slice" aria-hidden>
        <line x1="40" y1="30" x2="130" y2="70" stroke="#F5BC63" strokeWidth="1" />
        <line x1="130" y1="70" x2="250" y2="40" stroke="#F5BC63" strokeWidth="1" />
        <line x1="250" y1="40" x2="350" y2="85" stroke="#F5BC63" strokeWidth="1" />
        {[[40, 30], [130, 70], [250, 40], [350, 85], [200, 20]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r="2" fill="#F6CD88" />)}
      </svg>

      <div className="relative flex items-center gap-2.5">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-amber-400/12 text-amber-300">
          {complete ? <CheckCircle2 size={18} /> : <Target size={18} />}
        </span>
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-wide text-chalk-500">Today's mission</p>
          <p className="text-[15px] font-semibold text-chalk-50">
            {complete ? "Mission complete — every business contacted." : `Create ${total} new ${total === 1 ? "conversation" : "conversations"}`}
          </p>
        </div>
        <div className="ml-auto shrink-0 text-right">
          <p className="text-[17px] font-semibold tabular-nums text-chalk-50">{done}<span className="text-chalk-500">/{total}</span></p>
          {!complete && estMinutes > 0 && <p className="text-[11px] text-chalk-500">~{minutesLabel(estMinutes)} left</p>}
        </div>
      </div>

      <div className="relative mt-3">
        <ConstellationProgress total={total} done={done} />
      </div>
    </section>
  );
}
