"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/app/lib/supabase";
import {
  notificationForJob,
  notificationForPrinterStatus,
  type OperatorNotification,
} from "@/app/lib/notifications";
import type { Job } from "@/app/types/job";
import type { PrinterStatus } from "@/app/types/printer";

function toneClass(tone: OperatorNotification["tone"]): string {
  if (tone === "success") return "border-green/30 bg-green/10 text-green";
  if (tone === "error") return "border-red/30 bg-red/10 text-red";
  return "border-amber/30 bg-amber/10 text-amber";
}

export function NotificationProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const seen = useRef(new Set<string>());
  const [notifications, setNotifications] = useState<OperatorNotification[]>(
    [],
  );
  const [centerOpen, setCenterOpen] = useState(false);

  function add(notification: OperatorNotification | null) {
    if (!notification || seen.current.has(notification.id)) return;
    seen.current.add(notification.id);
    setNotifications((current) => [notification, ...current].slice(0, 50));
    window.setTimeout(() => {
      setNotifications((current) =>
        current.map((item) =>
          item.id === notification.id ? { ...item, toastHidden: true } : item,
        ) as OperatorNotification[],
      );
    }, 5_000);
  }

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("operator-notifications")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "jobs" },
        (payload) => add(notificationForJob(payload.new as Job)),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "printer_status" },
        (payload) =>
          add(notificationForPrinterStatus(payload.new as PrinterStatus)),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const visibleToasts = notifications
    .filter((notification) => !("toastHidden" in notification))
    .slice(0, 3);

  return (
    <>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-3">
        <button
          onClick={() => setCenterOpen((open) => !open)}
          className="rounded-md border border-border bg-surface px-3 py-2 text-xs font-semibold text-text shadow-lg"
        >
          Notifications {notifications.length}
        </button>
        {centerOpen && (
          <section className="max-h-96 w-80 overflow-auto rounded-lg border border-border bg-surface p-3 shadow-2xl">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-muted">
              Notification Center
            </h2>
            {notifications.length === 0 ? (
              <p className="mt-3 text-xs text-muted">No notifications</p>
            ) : (
              <div className="mt-3 grid gap-2">
                {notifications.map((notification) => (
                  <div
                    key={notification.id}
                    className={`rounded-md border px-3 py-2 ${toneClass(notification.tone)}`}
                  >
                    <p className="text-xs font-semibold">
                      {notification.title}
                    </p>
                    <p className="mt-1 text-xs opacity-90">
                      {notification.body}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
        <div className="grid w-80 gap-2">
          {visibleToasts.map((notification) => (
            <div
              key={notification.id}
              className={`rounded-md border px-3 py-2 shadow-lg ${toneClass(notification.tone)}`}
            >
              <p className="text-xs font-semibold">{notification.title}</p>
              <p className="mt-1 text-xs opacity-90">{notification.body}</p>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
