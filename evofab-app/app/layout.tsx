import type { Metadata } from "next";
import "./globals.css";
import { JobProvider } from "@/app/contexts/JobContext";
import { PrinterProvider } from "@/app/contexts/PrinterContext";
import { Topbar } from "@/app/components/layout/Topbar";
import { NavTabs } from "@/app/components/layout/NavTabs";

export const metadata: Metadata = {
  title: "FGF Pellet Printing System",
  description: "Nemtiz Robotics Group · Tufts University",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full flex flex-col bg-bg text-text antialiased">
        <JobProvider>
          <PrinterProvider>
            <Topbar />
            <div className="flex flex-col flex-1 pt-13">
              <NavTabs />
              <main className="flex-1 overflow-auto">{children}</main>
            </div>
          </PrinterProvider>
        </JobProvider>
      </body>
    </html>
  );
}
