import { usingDevPassword } from "@/lib/auth";
import { listOperators } from "@/lib/repo";
import { Atmosphere } from "@/components/Atmosphere";
import { BrandMark } from "@/components/BrandMark";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: { error?: string; from?: string } }) {
  const error = searchParams.error === "1";
  const rateLimited = searchParams.error === "rate";
  const from = searchParams.from ?? "/";
  // Who is signing in. The workspace is a shared internal tool behind one
  // password, so this establishes ACCOUNTABILITY, not authentication — every
  // action from this session is attributed to the operator chosen here.
  const operators = (await listOperators()).filter((o) => o.active);
  return (
    <div className="relative grid min-h-screen place-items-center px-4">
      <Atmosphere />
      <div className="w-full max-w-sm animate-scale-in">
        <div className="mb-8 flex flex-col items-center text-center">
          <BrandMark size={56} rounded="rounded-2xl" className="mb-4 shadow-glow-azure ring-1 ring-white/[0.08]" />
          <h1 className="text-xl font-semibold tracking-tight text-chalk-50">Artifex Labs</h1>
          <p className="mt-1.5 text-sm text-chalk-400">A calm studio for thoughtful business conversations.</p>
        </div>
        <form action="/api/auth/login" method="post" className="glass-3 p-6">
          <input type="hidden" name="from" value={from} />
          {operators.length > 1 && (
            <div className="mb-4">
              <label className="field-label" htmlFor="operator">Who is working</label>
              <select id="operator" name="operator" className="input" defaultValue={operators[0]?.id}>
                {operators.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            </div>
          )}
          <label className="field-label" htmlFor="password">Operator password</label>
          <input id="password" name="password" type="password" autoFocus className="input" placeholder="••••••••" />
          {error && <p className="mt-2 text-xs text-coral-300">Incorrect password. Try again.</p>}
          {rateLimited && <p className="mt-2 text-xs text-coral-300">Too many attempts. Please wait a few minutes and try again.</p>}
          <button type="submit" className="btn-primary mt-4 w-full">Sign in</button>
          {usingDevPassword() && (
            <p className="mt-3 text-center text-[11px] text-chalk-500">
              Dev mode — default password is <span className="font-mono text-chalk-300">artifex</span>. Set{" "}
              <span className="font-mono">OUTREACH_PASSWORD</span> before deploying.
            </p>
          )}
        </form>
        <p className="mt-6 text-center text-[11px] text-chalk-600">Artifex Labs · Build smarter.</p>
      </div>
    </div>
  );
}
