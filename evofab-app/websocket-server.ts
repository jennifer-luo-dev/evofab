/* websocket-server.ts: 
  This file sets up a WebSocket server to connect to the 
  Moonraker API for real-time printer status updates. It listens for status 
  updates and updates the printer status in the application accordingly.
*/
import WebSocket from "ws";
import { printerStatusManager } from "./app/lib/printer-status-manager";

export function connectPrinter(printerId: string, moonrakerUrl: string) {
  const ws = new WebSocket(moonrakerUrl);

  ws.on("open", () => {
    ws.send(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "printer.objects.subscribe",
        params: {
          objects: {
            print_stats: null,
            virtual_sdcard: null,
            extruder: ["temperature", "target"],
            heater_bed: ["temperature", "target"],
          },
        },
        id: 1,
      }),
    );
  });

  ws.on("message", (raw) => {
    const msg = JSON.parse(raw.toString());

    if (msg.method === "notify_status_update") {
      const status = msg.params[0];

      printerStatusManager.setStatus(printerId, status);
    }
  });
}
