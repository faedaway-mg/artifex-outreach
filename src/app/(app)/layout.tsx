import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/auth";
import { Shell } from "@/components/Shell";
import { Atmosphere } from "@/components/Atmosphere";

export const dynamic = "force-dynamic";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  if (!isAuthenticated()) redirect("/login");
  return (
    <>
      <Atmosphere />
      <Shell>{children}</Shell>
    </>
  );
}
