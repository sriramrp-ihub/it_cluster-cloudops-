import type { Metadata } from "next";
import { OperatorProvider } from "../auth/OperatorContext";
import { AppShell } from "../components/shell/AppShell";
import "../styles/globals.css";

export const metadata: Metadata = {
  title: "CloudOps — Autonomous AI Operations Control Plane",
  description: "Enterprise multi-cloud operations platform with strict cryptographic authority boundaries and real-time agent gateway."
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <OperatorProvider>
          <AppShell>{children}</AppShell>
        </OperatorProvider>
      </body>
    </html>
  );
}
