"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { VolumePoint } from "@/lib/types";

export function VolumeChart({ data }: { data: VolumePoint[] }) {
  return (
    <section className="panel" style={{ padding: 16 }}>
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: 12,
        }}
      >
        <h2 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>
          Call volume · 24h
        </h2>
        <div style={{ display: "flex", gap: 12, fontSize: 12 }}>
          <span style={{ color: "var(--good)" }}>● Real</span>
          <span style={{ color: "var(--synth)" }}>● Synthetic</span>
        </div>
      </header>
      <div style={{ width: "100%", height: 220 }}>
        <ResponsiveContainer>
          <AreaChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
            <defs>
              <linearGradient id="realFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#3ecf8e" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#3ecf8e" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="synthFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#a06bff" stopOpacity={0.3} />
                <stop offset="100%" stopColor="#a06bff" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#232733" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="bucket"
              tick={{ fill: "#8b90a0", fontSize: 11 }}
              axisLine={{ stroke: "#232733" }}
              tickLine={false}
              interval={3}
            />
            <YAxis
              tick={{ fill: "#8b90a0", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              allowDecimals={false}
            />
            <Tooltip
              contentStyle={{
                background: "#161922",
                border: "1px solid #232733",
                borderRadius: 8,
                fontSize: 12,
              }}
              labelStyle={{ color: "#e6e8ee" }}
            />
            <Area
              type="monotone"
              dataKey="real"
              stroke="#3ecf8e"
              strokeWidth={2}
              fill="url(#realFill)"
              name="Real"
            />
            <Area
              type="monotone"
              dataKey="synthetic"
              stroke="#a06bff"
              strokeWidth={2}
              fill="url(#synthFill)"
              name="Synthetic"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
