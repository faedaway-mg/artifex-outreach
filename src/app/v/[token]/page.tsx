import { getShare, isLive } from "@/lib/content-studio/share";
import { ARTIFEX_IDENTITY } from "@/lib/identity";
import { BrandMark } from "@/components/BrandMark";

export const dynamic = "force-dynamic";
// noindex — this is an unlisted link, not a public page. (noindex is NOT access control: anyone holding
// the link can forward it. Revoke to disable access.)
export const metadata = { robots: { index: false, follow: false } };

export default async function ViewingPage({ params }: { params: { token: string } }) {
  const share = await getShare(params.token);

  if (!share || !isLive(share)) {
    return (
      <Frame>
        <div className="card p-8 text-center">
          <p className="text-lg font-semibold text-chalk-50">This video isn’t available</p>
          <p className="mt-2 text-sm text-chalk-400">The link may have been disabled. If you were expecting a video, just reply to the email you received and we’ll send a fresh link.</p>
        </div>
      </Frame>
    );
  }

  const who = share.businessName || "your business";
  return (
    <Frame>
      <div className="mb-5 flex items-center gap-3">
        <BrandMark size={40} className="ring-1 ring-white/[0.08]" />
        <div>
          <p className="text-sm font-semibold text-chalk-50">{ARTIFEX_IDENTITY.companyName}</p>
          <p className="text-[11px] text-chalk-500">A short video review for {who}</p>
        </div>
      </div>

      <div className="card overflow-hidden p-3">
        {/* No autoplay, no sound-on by default; standard controls; portrait-safe. */}
        <video
          controls
          playsInline
          preload="metadata"
          poster={share.posterRel}
          src={`/api/v/${share.token}/video`}
          className="mx-auto block w-full max-w-[420px] rounded-lg bg-black"
          style={{ aspectRatio: "9 / 16" }}
        />
      </div>

      {share.intro && <p className="mt-4 text-center text-sm leading-relaxed text-chalk-300">{share.intro}</p>}

      <div className="mt-5 flex flex-col items-center gap-3">
        <a href={ARTIFEX_IDENTITY.bookingUrl} target="_blank" rel="noopener noreferrer" className="btn-primary w-full max-w-[420px] text-center text-sm">
          Book a conversation
        </a>
        <p className="text-center text-xs text-chalk-500">Or just reply to the email we sent — we read every one.</p>
      </div>

      <p className="mt-8 text-center text-[11px] text-chalk-600">{ARTIFEX_IDENTITY.companyName} · {ARTIFEX_IDENTITY.location}</p>
    </Frame>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-ink-975">
      <div className="mx-auto w-full max-w-lg px-4 py-8 md:py-14">{children}</div>
    </main>
  );
}
