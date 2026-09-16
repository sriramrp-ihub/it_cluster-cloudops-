"use client";

import { useEffect, use } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function OnboardingRequestRedirect({ params }: { params: Promise<{ requestId: string }> }) {
  const resolvedParams = use(params);
  const requestId = resolvedParams.requestId;
  const router = useRouter();

  useEffect(() => {
    router.replace(`/agents/join-requests/${requestId}`);
  }, [router, requestId]);

  return (
    <div style={{ padding: "48px", textAlign: "center" }}>
      <p style={{ color: "var(--mid-warm-gray)", marginBottom: "1rem" }}>
        Redirecting to Join Request review at <code className="code-inline">/agents/join-requests/{requestId}</code>...
      </p>
      <Link href={`/agents/join-requests/${requestId}`} className="btn-primary">
        Go to Review
      </Link>
    </div>
  );
}
