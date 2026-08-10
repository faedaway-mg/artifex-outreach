"use client";
// ─────────────────────────────────────────────────────────────────────────────
// Email signatures — the SAME canonical Artifex signature Acquisition OS puts on
// outbound email, made copyable for Outlook so replies look identical. Pick a signer,
// see the real signature, tap Copy, paste into Outlook. Also sets which human signs
// Acquisition OS outbound emails (the mailbox stays hello@artifexlabs.tech). Mobile-first.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useTransition } from "react";
import { Copy, Check, PenLine, Loader2 } from "lucide-react";
import { setOutreachSignerAction } from "@/lib/actions";

export interface SignatureProfileView {
  id: "jordan" | "alex";
  name: string;
  html: string;
  text: string;
}

export function EmailSignatures({ profiles, current }: { profiles: SignatureProfileView[]; current: "jordan" | "alex" }) {
  const [selectedId, setSelectedId] = useState<"jordan" | "alex">(current);
  const [signer, setSigner] = useState<"jordan" | "alex">(current);
  const [copied, setCopied] = useState<null | "rich" | "plain">(null);
  const [saving, startSave] = useTransition();

  const selected = profiles.find((p) => p.id === selectedId) ?? profiles[0];

  async function copySignature() {
    setCopied(null);
    try {
      if (navigator.clipboard && "write" in navigator.clipboard && typeof ClipboardItem !== "undefined") {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/html": new Blob([selected.html], { type: "text/html" }),
            "text/plain": new Blob([selected.text], { type: "text/plain" }),
          }),
        ]);
        setCopied("rich");
      } else {
        await navigator.clipboard.writeText(selected.text);
        setCopied("plain");
      }
    } catch {
      try { await navigator.clipboard.writeText(selected.text); setCopied("plain"); } catch { setCopied(null); }
    }
  }

  const setActiveSigner = () =>
    startSave(async () => {
      const res = await setOutreachSignerAction(selectedId);
      if (res.ok) setSigner(selectedId);
    });

  return (
    <section className="card space-y-3 p-5">
      <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-chalk-100"><PenLine size={15} className="text-azure-300" /> Email signatures</h2>
      <p className="text-[13px] leading-relaxed text-chalk-400">
        The same Artifex signature Acquisition OS puts on outreach — copy it into Outlook so your replies match.
      </p>

      {/* Signer picker — full-width segmented control, big touch targets. */}
      <div className="flex gap-1 rounded-lg border border-white/10 bg-ink-950/40 p-1">
        {profiles.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => { setSelectedId(p.id); setCopied(null); }}
            className={`flex-1 rounded-md px-3 py-2 text-[13.5px] font-medium transition ${selectedId === p.id ? "bg-azure-500/20 text-azure-100" : "text-chalk-400 hover:text-chalk-200"}`}
          >
            {p.name}
          </button>
        ))}
      </div>

      {/* Real rendered signature preview (what Outlook will show). */}
      <div className="overflow-x-auto rounded-lg border border-white/10 bg-white p-4">
        <div dangerouslySetInnerHTML={{ __html: selected.html }} />
      </div>

      <button onClick={copySignature} className="btn-primary w-full justify-center !py-3 text-[15px]">
        {copied ? <><Check size={16} /> {copied === "rich" ? "Signature copied — paste it into Outlook" : "Copied as plain text"}</> : <><Copy size={16} /> Copy signature</>}
      </button>
      {copied === "plain" && (
        <p className="text-[12px] text-amber-300/90">Rich copy isn&rsquo;t supported on this browser — plain text was copied instead.</p>
      )}

      <p className="text-[12px] leading-relaxed text-chalk-500">
        Copy this signature, then paste it into your Outlook signature settings (Outlook → Settings → Mail → Compose and reply → Email signature).
      </p>

      {/* Who signs Acquisition OS outbound email. */}
      <div className="mt-1 flex items-center justify-between gap-2 border-t border-white/[0.06] pt-3">
        <p className="text-[12.5px] text-chalk-400">
          Acquisition OS outreach is signed by <span className="text-chalk-100">{profiles.find((p) => p.id === signer)?.name}</span>.
        </p>
        {selectedId !== signer && (
          <button onClick={setActiveSigner} disabled={saving} className="btn-secondary shrink-0 !px-3 !py-1.5 text-[12.5px] disabled:opacity-60">
            {saving ? <Loader2 size={13} className="animate-spin" /> : `Use ${profiles.find((p) => p.id === selectedId)?.name}`}
          </button>
        )}
      </div>
    </section>
  );
}
