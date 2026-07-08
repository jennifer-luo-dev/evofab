import { notFound } from "next/navigation";
import { PrinterDetailShell } from "@/app/components/printers/PrinterDetailShell";
import { getPrinterDetailData } from "@/app/lib/printer-detail";

export default async function PrinterDetailModalPage({
  params,
}: {
  params: Promise<{ printerId: string }>;
}) {
  const { printerId } = await params;
  const detail = await getPrinterDetailData(printerId);
  if (!detail) notFound();

  return <PrinterDetailShell {...detail} overlay />;
}
