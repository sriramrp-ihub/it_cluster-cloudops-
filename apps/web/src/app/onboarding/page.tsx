"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function OnboardingRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/agents/add");
  }, [router]);

  return (
    <div style={{ padding: "48px", textAlign: "center" }}>
      <p style={{ color: "var(--mid-warm-gray)", marginBottom: "1rem" }}>
        Redirecting to the new DevOps Agent Onboarding flow at <code className="code-inline">/agents/add</code>...
      </p>
      <Link href="/agents/add" className="btn-primary">
        Go to Add Agent
      </Link>
    </div>
  );
}
