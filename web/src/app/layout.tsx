import type { Metadata } from "next";
import { SideNav } from "@/components/SideNav";
import { TopBar } from "@/components/TopBar";
import { AuthProvider } from "@/lib/auth";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "FlameMind", template: "%s | FlameMind" },
  description: "Fire safety insights for living beyond Earth.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body className="min-h-dvh font-sans antialiased">
        <AuthProvider>
          <TopBar />
          <div className="flex min-h-[calc(100dvh-3.5rem)] flex-col md:flex-row">
            <SideNav />
            <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
          </div>
        </AuthProvider>
      </body>
    </html>
  );
}
