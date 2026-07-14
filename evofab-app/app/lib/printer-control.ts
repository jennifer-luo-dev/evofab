import {
  cancelPrint,
  emergencyStop,
  firmwareRestartKlipper,
  pausePrint,
  restartKlipper,
  resumePrint,
} from "@/app/lib/moonraker";

export type PrinterControlAction =
  | "start"
  | "pause"
  | "resume"
  | "cancel"
  | "emergency_stop"
  | "restart"
  | "firmware_restart";

export interface PrinterAddress {
  ip: string;
  port: number;
}

export async function runPrinterControl(
  printer: PrinterAddress,
  action: PrinterControlAction,
): Promise<void> {
  if (action === "pause") return pausePrint(printer.ip, printer.port);
  if (action === "resume") return resumePrint(printer.ip, printer.port);
  if (action === "cancel") return cancelPrint(printer.ip, printer.port);
  if (action === "emergency_stop")
    return emergencyStop(printer.ip, printer.port);
  if (action === "restart") return restartKlipper(printer.ip, printer.port);
  return firmwareRestartKlipper(printer.ip, printer.port);
}

export function controlRequiresGuard(action: PrinterControlAction): boolean {
  return action === "restart" || action === "firmware_restart";
}

export function expectedControlConfirmation(
  action: PrinterControlAction,
): string {
  return action === "restart" ? "RESTART" : "FIRMWARE_RESTART";
}
