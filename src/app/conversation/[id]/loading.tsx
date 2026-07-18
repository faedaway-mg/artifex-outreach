import { PageLoading } from "@/components/PageLoading";
export default function Loading() {
  return (
    <main className="min-h-screen bg-ink-950 px-4 py-6 md:px-8 md:py-10">
      <div className="mx-auto max-w-4xl"><PageLoading label="Preparing your focus space…" rows={4} /></div>
    </main>
  );
}
