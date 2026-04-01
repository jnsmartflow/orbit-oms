"use client";

import React, { useState, useEffect } from "react";

// ── Types ────────────────────────────────────────────────────────────────────

interface SummaryData {
  import: {
    totalToday: number;
    pendingSupport: number;
    onHold: number;
    dispatched: number;
  };
  tinting: { pending: number; inProgress: number; done: number };
  dispatch: {
    draftTrips: number;
    confirmedTrips: number;
    dispatchedTrips: number;
    vehiclesOut: number;
  };
  warehouse: { unassigned: number; picking: number; picked: number };
  alerts: { overdue: number; onHold: number; closedSlot: number };
}

// ── Component ────────────────────────────────────────────────────────────────

export function OperationsOverview() {
  const [data, setData] = useState<SummaryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  useEffect(() => {
    let mounted = true;

    async function fetchSummary() {
      try {
        const res = await fetch("/api/operations/summary");
        if (!res.ok) return;
        const json = (await res.json()) as SummaryData;
        if (mounted) {
          setData(json);
          setLastUpdated(new Date());
          setLoading(false);
        }
      } catch {
        // silently ignore
      }
    }

    void fetchSummary();
    const interval = setInterval(() => void fetchSummary(), 60000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  if (loading) return <SkeletonGrid />;
  if (!data) return <p className="p-6 text-sm text-gray-400">Failed to load summary</p>;

  const alerts: string[] = [];
  if (data.alerts.overdue > 0)
    alerts.push(`⚠ ${data.alerts.overdue} orders overdue (carried over from previous days)`);
  if (data.alerts.onHold > 0)
    alerts.push(`⚠ ${data.alerts.onHold} orders on hold awaiting release`);
  if (data.alerts.closedSlot > 0)
    alerts.push(`⚠ ${data.alerts.closedSlot} orders in closed slot (cascade pending)`);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-gray-900">Operations Overview</h2>
        {lastUpdated && (
          <span className="text-sm text-gray-400">
            Last updated {lastUpdated.toLocaleTimeString("en-GB")}
          </span>
        )}
      </div>

      {/* Import */}
      <Section label="Import">
        <div className="grid grid-cols-4 gap-4">
          <StatCard value={data.import.totalToday} label="Total OBDs Today" />
          <StatCard value={data.import.pendingSupport} label="Pending Support" />
          <StatCard value={data.import.onHold} label="On Hold" />
          <StatCard value={data.import.dispatched} label="Dispatched" />
        </div>
      </Section>

      {/* Tinting */}
      <Section label="Tinting">
        <div className="grid grid-cols-3 gap-4">
          <StatCard value={data.tinting.pending} label="Pending Tint" />
          <StatCard value={data.tinting.inProgress} label="In Progress" />
          <StatCard value={data.tinting.done} label="Done" />
        </div>
      </Section>

      {/* Dispatch */}
      <Section label="Dispatch">
        <div className="grid grid-cols-4 gap-4">
          <StatCard value={data.dispatch.draftTrips} label="Draft Trips" />
          <StatCard value={data.dispatch.confirmedTrips} label="Confirmed Trips" />
          <StatCard value={data.dispatch.dispatchedTrips} label="Dispatched Trips" />
          <StatCard value={data.dispatch.vehiclesOut} label="Vehicles Out" />
        </div>
      </Section>

      {/* Warehouse */}
      <Section label="Warehouse">
        <div className="grid grid-cols-3 gap-4">
          <StatCard value={data.warehouse.unassigned} label="Unassigned" />
          <StatCard value={data.warehouse.picking} label="Being Picked" />
          <StatCard value={data.warehouse.picked} label="Fully Picked" />
        </div>
      </Section>

      {/* Alerts */}
      {alerts.length > 0 && (
        <div className="space-y-2">
          {alerts.map((alert) => (
            <div
              key={alert}
              className="rounded-lg border border-amber-400 bg-amber-50 p-4 text-amber-800 text-sm"
            >
              {alert}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">
        {label}
      </p>
      {children}
    </div>
  );
}

function StatCard({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <p className="text-3xl font-bold text-gray-900">{value}</p>
      <p className="text-sm text-gray-500 mt-1">{label}</p>
    </div>
  );
}

function SkeletonGrid() {
  return (
    <div className="p-6 space-y-6">
      <div className="h-7 w-48 bg-gray-200 rounded animate-pulse" />
      {[4, 3, 4, 3].map((cols, i) => (
        <div key={i}>
          <div className="h-4 w-20 bg-gray-200 rounded animate-pulse mb-2" />
          <div className={`grid grid-cols-${cols} gap-4`}>
            {Array.from({ length: cols }).map((_, j) => (
              <div key={j} className="rounded-lg border border-gray-200 bg-white p-4">
                <div className="h-9 w-16 bg-gray-200 rounded animate-pulse" />
                <div className="h-4 w-24 bg-gray-100 rounded animate-pulse mt-2" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
