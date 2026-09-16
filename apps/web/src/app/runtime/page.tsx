"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function RuntimeRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/agents/diagnostics");
  }, [router]);

  return (
    <div style={{ padding: "48px", textAlign: "center" }}>
      <p style={{ color: "var(--mid-warm-gray)", marginBottom: "1rem" }}>
        Redirecting to Agent Diagnostics at <code className="code-inline">/agents/diagnostics</code>...
      </p>
      <Link href="/agents/diagnostics" className="btn-primary">
        Go to Diagnostics
      </Link>
    </div>
  );
}
