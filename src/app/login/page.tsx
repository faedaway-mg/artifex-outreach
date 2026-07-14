import { usingDevPassword } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default function LoginPage({ searchParams }: { searchParams: { error?: string; from?: string } }) {
  const error = searchParams.error === "1";
  const rateLimited = searchParams.error === "rate";
  const from = searchParams.from ?? "/";
  return (
    <div className="grid min-h-screen place-items-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-4 grid h-12 w-12 place-items-center rounded-xl bg-gradient-to-br from-azure-500 to-indigo-500 text-lg font-bold text-white">
            A
          </div>
          <h1 className="text-xl font-semibold text-chalk-50">Artifex Outreach</h1>
          <p className="mt-1 text-sm text-chalk-400">Daily client-acquisition system for Artifex Labs</p>
        </div>
        <form action="/api/auth/login" method="post" className="card p-6">
          <input type="hidden" name="from" value={from} />
          <label className="field-label" htmlFor="password">
            Operator password
          </label>
          <input id="password" name="password" type="password" autoFocus className="input" placeholder="••••••••" />
          {error && <p className="mt-2 text-xs text-red-300">Incorrect password. Try again.</p>}
          {rateLimited && <p className="mt-2 text-xs text-red-300">Too many attempts. Please wait a few minutes and try again.</p>}
          <button type="submit" className="btn-primary mt-4 w-full">
            Sign in
          </button>
          {usingDevPassword() && (
            <p className="mt-3 text-center text-[11px] text-chalk-600">
              Dev mode — default password is <span className="font-mono text-chalk-400">artifex</span>. Set{" "}
              <span className="font-mono">OUTREACH_PASSWORD</span> before deploying.
            </p>
          )}
        </form>
      </div>
    </div>
  );
}
