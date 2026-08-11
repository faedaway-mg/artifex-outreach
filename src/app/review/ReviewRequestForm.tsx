"use client";
import { useState, useTransition } from "react";
import { CheckCircle2, ArrowRight } from "lucide-react";
import { requestReviewAction } from "./actions";

export function ReviewRequestForm({ refCode }: { refCode?: string }) {
  const [pending, start] = useTransition();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ businessName: "", website: "", contactName: "", email: "", context: "" });

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res = await requestReviewAction({ ...form, ref: refCode });
      if (res.ok) setDone(true);
      else setError(res.reason ?? "Something went wrong — please try again.");
    });
  };

  if (done) {
    return (
      <div className="rounded-2xl border border-teal-400/25 bg-teal-400/[0.05] p-6 text-center">
        <CheckCircle2 className="mx-auto text-teal-300" size={28} />
        <h2 className="mt-3 text-lg font-semibold text-chalk-50">Request received.</h2>
        <p className="mx-auto mt-1 max-w-md text-sm text-chalk-300">
          We’ll take a real look at {form.businessName || "your business"} and send your one-page Business
          Technology Review to <span className="text-chalk-100">{form.email}</span>. No cost, nothing to sign.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-[12px] font-medium text-chalk-400">Business name *</span>
          <input required value={form.businessName} onChange={set("businessName")} className="input" placeholder="Taylor Family Dental" />
        </label>
        <label className="block">
          <span className="mb-1 block text-[12px] font-medium text-chalk-400">Website</span>
          <input value={form.website} onChange={set("website")} className="input" placeholder="taylordental.com" inputMode="url" />
        </label>
        <label className="block">
          <span className="mb-1 block text-[12px] font-medium text-chalk-400">Your name</span>
          <input value={form.contactName} onChange={set("contactName")} className="input" placeholder="Dr. Taylor" />
        </label>
        <label className="block">
          <span className="mb-1 block text-[12px] font-medium text-chalk-400">Email *</span>
          <input required type="email" value={form.email} onChange={set("email")} className="input" placeholder="you@business.com" inputMode="email" />
        </label>
      </div>
      <label className="block">
        <span className="mb-1 block text-[12px] font-medium text-chalk-400">What’s the one thing that frustrates you about how your business runs? (optional)</span>
        <textarea value={form.context} onChange={set("context")} rows={3} className="input resize-none" placeholder="Booking takes too many steps / we lose track of leads / …" />
      </label>

      {error && <p className="text-sm text-coral-300">{error}</p>}

      <button type="submit" disabled={pending} className="btn-primary w-full justify-center !py-3.5 text-[15px] disabled:opacity-60">
        {pending ? "Sending…" : <>Request my Business Technology Review <ArrowRight size={17} /></>}
      </button>
      <p className="text-center text-[12px] text-chalk-600">No cost. No obligation. We’ll only use your email to send the review and follow up about it.</p>
    </form>
  );
}
