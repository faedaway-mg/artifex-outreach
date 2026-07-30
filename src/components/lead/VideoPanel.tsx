"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Video, Clapperboard, ExternalLink, Check, Link2, Save } from "lucide-react";
import { ActionButton } from "@/components/ActionButton";
import {
  generateVideoAction,
  updateVideoScriptAction,
  setVideoUrlAction,
  markVideoReadyAction,
} from "@/lib/actions";
import type { Lead, Video as VideoT, Screenshot } from "@/lib/types";
import { normalizeExternalUrl } from "@/lib/utils";

export function VideoPanel({ lead, videos, screenshots }: { lead: Lead; videos: VideoT[]; screenshots: Screenshot[] }) {
  const router = useRouter();
  const refresh = () => router.refresh();
  const video = videos.at(-1);
  const isTierA = lead.tier === "A";

  return (
    <div className="card p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-chalk-100">Personalized video</h2>
          <p className="text-xs text-chalk-500">
            {isTierA ? "Recommended for this Tier A lead." : "Optional — usually reserved for Tier A."} 60–120s screenshot walkthrough.
          </p>
        </div>
        {video && <span className="rounded-full border border-white/10 px-2 py-0.5 text-xs capitalize text-chalk-400">{video.status.replace("_", " ")}</span>}
      </div>

      {!video ? (
        <ActionButton variant="primary" onRun={() => generateVideoAction(lead.id).then(refresh)}>
          <Clapperboard size={15} /> Generate video script & plan
        </ActionButton>
      ) : (
        <VideoEditor lead={lead} video={video} screenshots={screenshots} onRefresh={refresh} />
      )}
    </div>
  );
}

function VideoEditor({ lead, video, screenshots, onRefresh }: { lead: Lead; video: VideoT; screenshots: Screenshot[]; onRefresh: () => void }) {
  const router = useRouter();
  const websiteHref = normalizeExternalUrl(lead.website);
  return (
    <div className="space-y-4">
      <div className="grid gap-2 rounded-lg border border-white/[0.06] p-3 text-xs sm:grid-cols-2">
        <p><span className="text-chalk-500">Recommended length:</span> <span className="text-chalk-200">{video.recommendedLength}</span></p>
        <p><span className="text-chalk-500">Follow-up:</span> <span className="text-chalk-200">{video.followUpDate ? new Date(video.followUpDate).toLocaleDateString() : "—"}</span></p>
        <p className="sm:col-span-2"><span className="text-chalk-500">Positive opening:</span> <span className="text-chalk-200">{video.positiveOpening}</span></p>
      </div>

      {/* Script editor */}
      <form
        action={updateVideoScriptAction.bind(null, video.id, lead.id)}
        onSubmit={() => setTimeout(onRefresh, 300)}
        className="space-y-2"
      >
        <label className="block"><span className="field-label">Title</span><input name="title" defaultValue={video.title} className="input" /></label>
        <label className="block"><span className="field-label">Script</span><textarea name="script" defaultValue={video.script} rows={8} className="input font-mono text-xs leading-relaxed" /></label>
        <label className="block"><span className="field-label">CTA</span><input name="cta" defaultValue={video.cta} className="input" /></label>
        <label className="block"><span className="field-label">Accompanying email</span><textarea name="accompanyingEmail" defaultValue={video.accompanyingEmail} rows={2} className="input text-sm" /></label>
        <button type="submit" className="btn-secondary text-xs"><Save size={13} /> Save script</button>
      </form>

      {/* Screenshots to display */}
      {screenshots.length > 0 && (
        <div>
          <p className="label mb-2">Screenshots to display</p>
          <div className="flex flex-wrap gap-2">
            {screenshots.map((s) => (
              <a key={s.id} href={s.storageUrl} target="_blank" rel="noreferrer" className="rounded-lg border border-white/10 px-2 py-1 text-xs text-chalk-300 hover:border-white/20">
                {s.caption}
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Record + link */}
      <div className="flex flex-wrap items-center gap-2">
        {websiteHref && (
          <a href={websiteHref} target="_blank" rel="noopener noreferrer" aria-label={`Open ${lead.businessName} website in a new tab`} className="btn-secondary"><ExternalLink size={14} aria-hidden /> Open website</a>
        )}
        <a href="https://www.loom.com/record" target="_blank" rel="noopener noreferrer" className="btn-secondary"><Video size={14} aria-hidden /> Record (Loom)</a>
      </div>

      <form action={setVideoUrlAction.bind(null, video.id, lead.id)} onSubmit={() => setTimeout(() => router.refresh(), 300)} className="flex gap-2">
        <input name="videoUrl" defaultValue={video.videoUrl ?? ""} placeholder="Paste Loom / Tella / Vimeo URL" className="input" />
        <button type="submit" className="btn-secondary whitespace-nowrap"><Link2 size={14} /> Save URL</button>
      </form>

      {video.videoUrl && video.status !== "ready" && (
        <ActionButton variant="primary" onRun={() => markVideoReadyAction(video.id, lead.id).then(onRefresh)}>
          <Check size={15} /> Mark video ready
        </ActionButton>
      )}
      {video.status === "ready" && <p className="text-xs text-emerald-300">✓ Video ready to include in outreach.</p>}
    </div>
  );
}
