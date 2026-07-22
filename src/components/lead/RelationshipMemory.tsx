import { Brain, ShieldCheck, CircleHelp, Plus } from "lucide-react";
import type { RelationshipMemoryItem, MemoryStatus } from "@/lib/types";
import { MEMORY_CATEGORIES, MEMORY_CONFIDENCES, MEMORY_SOURCES } from "@/lib/types";
import { addMemoryAction, setMemoryStatusAction, deleteMemoryAction } from "@/lib/memory-actions";

const STATUS_STYLE: Record<MemoryStatus, string> = {
  Proposed: "border-amber-400/30 text-amber-300",
  Verified: "border-teal-400/30 text-teal-300",
  Superseded: "border-white/10 text-chalk-600 line-through",
  Resolved: "border-white/10 text-chalk-500",
};
const CONF_STYLE: Record<string, string> = { High: "text-teal-300", Medium: "text-amber-300", Low: "text-coral-300" };

function Item({ item, leadId }: { item: RelationshipMemoryItem; leadId: string }) {
  return (
    <div className="border-t border-white/[0.05] py-3 first:border-t-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13.5px] font-medium text-chalk-100">{item.title}</p>
          <p className="mt-0.5 text-[13.5px] leading-relaxed text-chalk-300">{item.value}</p>
        </div>
        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10.5px] ${STATUS_STYLE[item.status]}`}>{item.status}</span>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-chalk-600">
        <span className={CONF_STYLE[item.confidence]}>{item.confidence} confidence</span>
        <span>· via {item.source}</span>
        {item.supportingContext && <span className="text-chalk-500">· “{item.supportingContext}”</span>}
      </div>
      {/* Earn the status change — never automatic */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {item.status === "Proposed" && (
          <form action={setMemoryStatusAction.bind(null, item.id, leadId, "Verified")}>
            <button className="rounded-md border border-teal-400/20 px-2 py-0.5 text-[11px] text-teal-300 hover:bg-teal-400/[0.06]">Verify</button>
          </form>
        )}
        {item.status !== "Superseded" && (
          <form action={setMemoryStatusAction.bind(null, item.id, leadId, "Superseded")}>
            <button className="rounded-md border border-white/10 px-2 py-0.5 text-[11px] text-chalk-500 hover:text-chalk-300">Supersede</button>
          </form>
        )}
        {item.status !== "Resolved" && (
          <form action={setMemoryStatusAction.bind(null, item.id, leadId, "Resolved")}>
            <button className="rounded-md border border-white/10 px-2 py-0.5 text-[11px] text-chalk-500 hover:text-chalk-300">Resolve</button>
          </form>
        )}
        <form action={deleteMemoryAction.bind(null, item.id, leadId)}>
          <button className="rounded-md px-2 py-0.5 text-[11px] text-chalk-700 hover:text-coral-300">Remove</button>
        </form>
      </div>
    </div>
  );
}

const inputCls = "rounded-lg border border-white/10 bg-ink-950/40 px-2.5 py-1.5 text-[13px] text-chalk-200 placeholder:text-chalk-600 focus:border-azure-400/40 focus:outline-none";

/**
 * Relationship Memory — accumulated understanding of the business, with provenance
 * and confidence preserved. Reads like a knowledge base, not a CRM.
 */
export function RelationshipMemory({ items, leadId }: { items: RelationshipMemoryItem[]; leadId: string }) {
  const byCategory = MEMORY_CATEGORIES.map((c) => ({ category: c, items: items.filter((i) => i.category === c) })).filter((g) => g.items.length > 0);

  return (
    <section className="card p-5">
      <div className="flex items-center gap-2">
        <Brain size={16} className="text-azure-300" />
        <h2 className="text-sm font-semibold text-chalk-100">Relationship memory</h2>
        <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-chalk-600"><ShieldCheck size={12} /> {items.filter((i) => i.status === "Verified").length} verified · {items.length} total</span>
      </div>
      <p className="mt-1 text-[12px] text-chalk-500">What we've learned about this business. Nothing here becomes fact until you verify it.</p>

      {byCategory.length === 0 ? (
        <p className="mt-4 flex items-center gap-2 text-[13px] text-chalk-500"><CircleHelp size={14} /> Nothing captured yet. After a conversation, promote what you learn below.</p>
      ) : (
        <div className="mt-4 space-y-5">
          {byCategory.map((g) => (
            <div key={g.category}>
              <p className="text-[11px] font-medium uppercase tracking-wide text-chalk-500">{g.category}</p>
              <div className="mt-1">
                {g.items.map((i) => <Item key={i.id} item={i} leadId={leadId} />)}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Promote a discovery into memory */}
      <details className="mt-5 border-t border-white/[0.06] pt-4">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[13px] font-medium text-chalk-300">
          <Plus size={14} className="text-azure-300" /> Promote a discovery to memory
        </summary>
        <form action={addMemoryAction.bind(null, leadId)} className="mt-3 space-y-2.5">
          <input name="title" placeholder="Title — e.g. Prefers phone booking" required className={`w-full ${inputCls}`} />
          <textarea name="value" placeholder="What you learned — in their words where possible" required rows={2} className={`w-full ${inputCls}`} />
          <textarea name="supportingContext" placeholder="Why we believe this (optional)" rows={1} className={`w-full ${inputCls}`} />
          <div className="grid gap-2 sm:grid-cols-3">
            <select name="category" className={inputCls} defaultValue="Business Philosophy">
              {MEMORY_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <select name="confidence" className={inputCls} defaultValue="Medium">
              {MEMORY_CONFIDENCES.map((c) => <option key={c} value={c}>{c} confidence</option>)}
            </select>
            <select name="source" className={inputCls} defaultValue="Discovery Meeting">
              {MEMORY_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <p className="text-[11px] text-chalk-600">Starts as “Proposed”. Choose “Manual Confirmation” only when you're certain.</p>
          <button className="btn-primary !px-4 !py-1.5 text-[13px]">Add to memory</button>
        </form>
      </details>
    </section>
  );
}
