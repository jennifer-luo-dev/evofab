"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface TemperaturePoint {
  time: string;
  hotend: number;
  bed: number;
}

export function TemperatureChart({ data }: { data: TemperaturePoint[] }) {
  return (
    <div className="p-5 rounded-2xl border border-border bg-surface">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-widest text-muted">
            Thermal profile
          </h3>
          <p className="text-[10px] text-muted mt-1">Live target stability</p>
        </div>
        <div className="flex gap-3 text-[10px] font-mono">
          <span className="text-teal">● Hotend</span>
          <span className="text-amber">● Bed</span>
        </div>
      </div>
      <div className="h-52">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid stroke="rgba(255,255,255,.05)" vertical={false} />
            <XAxis
              dataKey="time"
              tick={{ fill: "#5A6480", fontSize: 9 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: "#5A6480", fontSize: 9 }}
              axisLine={false}
              tickLine={false}
              width={28}
            />
            <Tooltip
              contentStyle={{
                background: "#141C30",
                border: "1px solid rgba(255,255,255,.1)",
                borderRadius: 10,
                fontSize: 11,
              }}
            />
            <Line
              type="monotone"
              dataKey="hotend"
              stroke="#00D4B4"
              dot={false}
              strokeWidth={2}
            />
            <Line
              type="monotone"
              dataKey="bed"
              stroke="#F59E0B"
              dot={false}
              strokeWidth={2}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
