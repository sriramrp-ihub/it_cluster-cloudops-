"use client";

import React, { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useOperator } from "./OperatorContext";

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { session, isLoading } = useOperator();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!isLoading && !session && pathname !== "/login") {
      router.push("/login");
    }
  }, [isLoading, session, pathname, router]);

  if (isLoading) {
    return (
      <div style={{ padding: "64px", textAlign: "center", color: "var(--mid-warm-gray)" }}>
        <div style={{ fontFamily: "var(--font-serif)", fontSize: "20px", marginBottom: "8px" }}>
          Authenticating Operator Session...
        </div>
        <div style={{ fontSize: "13px", fontFamily: "var(--font-mono)" }}>
          Validating cryptographic control plane boundaries
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
