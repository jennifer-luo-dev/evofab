type PrinterStatus = {
  print_stats?: any;
  extruder?: any;
  heater_bed?: any;
  virtual_sdcard?: any;
};

class PrinterStatusManager {
  private statuses = new Map<string, PrinterStatus>();

  setStatus(printerId: string, status: PrinterStatus) {
    const existing = this.statuses.get(printerId) ?? {};

    this.statuses.set(printerId, {
      ...existing,
      ...status,
    });
  }

  getStatus(printerId: string) {
    return this.statuses.get(printerId) ?? null;
  }

  getAllStatuses() {
    return this.statuses;
  }
}

export const printerStatusManager = new PrinterStatusManager();
