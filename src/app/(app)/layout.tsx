import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/auth";
import { Shell } from "@/components/Shell";
import { Atmosphere } from "@/components/Atmosphere";
import { ImpersonationBanner } from "@/components/ImpersonationBanner";

export const dynamic = "force-dynamic";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  if (!isAuthenticated()) redirect("/login");
  return (
    <>
      <Atmosphere />
      {/* Above the shell on purpose: if a manager is standing at someone else's
          desk, that fact outranks every other thing on the screen. */}
      <ImpersonationBanner />
      <Shell>{children}</Shell>
    </>
  );
}
