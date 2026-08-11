import type { Metadata } from "next";
import { Eye, Search, Wrench, ArrowRight } from "lucide-react";
import { ReviewRequestForm } from "./ReviewRequestForm";
import { sanitizeRef } from "@/lib/acquisition/provenance";

// Public, indexable landing — the inbound front door. Overrides the app's global noindex.
export const metadata: Metadata = {
  title: "Business Technology Review · Artifex Labs",
  description: "We look at how your business actually runs and show you the specific, high-leverage places technology would remove friction — one page, no cost, nothing to sign.",
  robots: { index: true, follow: true },
  openGraph: {
    title: "Get a Business Technology Review — Artifex Labs",
    description: "We look at your business and show you where technology would remove real friction. One page. No cost.",
    type: "website",
  },
};

export const dynamic = "force-dynamic";

const STEPS = [
  { icon: Eye, title: "We look — really look", body: "Not a sales audit. We study how a customer actually moves through your business and where the friction is." },
  { icon: Search, title: "We find the leverage", body: "The two or three specific places where a small system would save real time or win real revenue — with the reasoning." },
  { icon: Wrench, title: "You get one page", body: "A concrete Business Technology Review you can act on with or without us. No cost, nothing to sign." },
];

export default function ReviewLandingPage({ searchParams }: { searchParams?: { ref?: string } }) {
  const refCode = sanitizeRef(searchParams?.ref) ?? undefined;
  return (
    <main className="mx-auto min-h-screen max-w-2xl px-5 py-12 sm:py-16">
      <header className="text-center">
        <p className="text-[12px] font-medium uppercase tracking-[0.2em] text-azure-300">Artifex Labs</p>
        <h1 className="mt-3 text-3xl font-semibold leading-tight text-chalk-50 sm:text-4xl">
          Let us look at your business.
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-chalk-300">
          We build systems that quietly remove the busywork out of how a business runs. Before we ever talk about
          working together, we’ll show you what we’d change — a <span className="text-chalk-100">Business Technology
          Review</span> of your business. One page. No cost. Nothing to sign.
        </p>
      </header>

      <section className="mt-10 grid gap-3 sm:grid-cols-3">
        {STEPS.map((s) => {
          const Icon = s.icon;
          return (
            <div key={s.title} className="card p-4">
              <Icon size={18} className="text-teal-300" />
              <h2 className="mt-2 text-sm font-semibold text-chalk-100">{s.title}</h2>
              <p className="mt-1 text-[13px] leading-relaxed text-chalk-400">{s.body}</p>
            </div>
          );
        })}
      </section>

      <section className="mt-10">
        <div className="card p-6 sm:p-8">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-chalk-50">
            Request your review <ArrowRight size={18} className="text-azure-300" />
          </h2>
          <p className="mt-1 mb-5 text-[13.5px] text-chalk-400">Takes about a minute. We’ll email it to you.</p>
          <ReviewRequestForm refCode={refCode} />
        </div>
      </section>

      <footer className="mt-10 text-center text-[12px] text-chalk-600">
        Artifex Labs — we use technology to remove unnecessary human friction, not to automate a bad process faster.
      </footer>
    </main>
  );
}
