import type { Metadata } from "next";
import { Geist_Mono, DM_Sans } from "next/font/google";
import "./globals.css";
import { JobProvider } from "@/app/contexts/JobContext";
import { PrinterProvider } from "@/app/contexts/PrinterContext";
import { Topbar } from "@/app/components/layout/Topbar";
import { NavTabs } from "@/app/components/layout/NavTabs";
import { NotificationProvider } from "@/app/components/notifications/NotificationProvider";

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "EvoFab SDL",
  description: "Self-Driving Lab — Nemitz Robotics Lab · Tufts ME",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${dmSans.variable} ${geistMono.variable} h-full`}
    >
      <body className="min-h-full flex flex-col bg-bg text-text antialiased">
        <JobProvider>
          <PrinterProvider>
            <NotificationProvider>
              <Topbar />
              <div className="flex flex-col flex-1 pt-13">
                <NavTabs />
                <main className="flex-1 overflow-auto">
                  {children}
                </main>
              </div>
            </NotificationProvider>
          </PrinterProvider>
        </JobProvider>
      </body>
    </html>
  );
}
