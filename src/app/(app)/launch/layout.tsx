import { LaunchNav } from "@/components/launch/LaunchNav";

export default function LaunchLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <div>
        <p className="label">Launch Readiness</p>
        <h1 className="mt-1 text-2xl font-semibold text-chalk-50">Launch Intelligence</h1>
        <p className="mt-1 text-sm text-chalk-400">Is the system healthy? Is outreach working? Is the intelligence accurate? Are we learning? Are we ready?</p>
      </div>
      <LaunchNav />
      {children}
    </div>
  );
}
