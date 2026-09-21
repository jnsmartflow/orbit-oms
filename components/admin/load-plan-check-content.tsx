"use client";

// Admin — LOAD PLAN CHECK (2026-09-21, owner).
//
// How well the Upcountry load plan matched the trips planners actually made,
// compared BY BILL (GET /api/admin/load-plan-check). Day view and week view.
// Superuser only (the admin layout and the API both check). The only money
// figure is plan ÷ actual cost as a PERCENTAGE.

import { useEffect, useState } from "react";
import { differenceText, type DayCheck, type WeekCheck } from "@/lib/trips/load-plan-check";
import type { DayCheckResult } from "@/lib/floor/load-plan-check-data";

type DayRes = { view: "day"; day: DayCheckResult };
type WeekRes = { view: "week"; days: DayCheckResult[]; week: WeekCheck; costPct: number | null };

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const todayIst = () => new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);
const pct = (n: number | null, d = 0) => (n === null ? "—" : `${n.toFixed(d)}%`);
const avg = (sum: number, n: number) => (n > 0 ? (sum / n).toFixed(1) : "—");

export function LoadPlanCheckContent() {
  const [date, setDate] = useState(todayIst());
  const [view, setView] = useState<"day" | "week">("day");
  const [snapshot, setSnapshot] = useState<string>("");
  const [data, setData] = useState<DayRes | WeekRes | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const ctl = new AbortController();
    setLoading(true);
    setError(null);
    const q = new URLSearchParams({ date, view, ...(view === "day" && snapshot ? { snapshot } : {}) });
    fetch(`/api/admin/load-plan-check?${q.toString()}`, { signal: ctl.signal })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? `Error ${r.status}`);
        setData(j as DayRes | WeekRes);
      })
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setError(e instanceof Error ? e.message : "Could not load");
      })
      .finally(() => setLoading(false));
    return () => ctl.abort();
  }, [date, view, snapshot]);

  return (
    <div className="mx-auto max-w-[1100px] px-4 py-6">
      <h1 className="text-[20px] font-bold text-gray-900">Load plan check</h1>
      <p className="mt-1 text-[13px] text-gray-500">
        The Upcountry load plan (the 15:00 snapshot unless you pick another) against the trips planners made that day, bill by bill.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <input
          type="date"
          value={date}
          onChange={(e) => {
            setDate(e.target.value);
            setSnapshot("");
          }}
          className="rounded-md border border-gray-300 px-2 py-1 text-[13px]"
        />
        <div className="flex overflow-hidden rounded-md border border-gray-300 text-[13px]">
          {(["day", "week"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={`px-3 py-1 ${view === v ? "bg-gray-900 text-white" : "bg-white text-gray-700"}`}
            >
              {v === "day" ? "Day" : "Week (7 days to this date)"}
            </button>
          ))}
        </div>
        {data?.view === "day" && data.day.snapshots.length > 1 && (
          <select value={snapshot} onChange={(e) => setSnapshot(e.target.value)} className="rounded-md border border-gray-300 px-2 py-1 text-[13px]">
            <option value="">Default (15:00, else latest)</option>
            {data.day.snapshots.map((s) => (
              <option key={s.id} value={s.id}>
                {s.source === "auto" ? "15:00 auto" : "Replan"} · {new Date(s.takenAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" })}
              </option>
            ))}
          </select>
        )}
        {loading && <span className="text-[12px] text-gray-400">Loading…</span>}
      </div>

      {error && <p className="mt-4 text-[13px] text-red-600">{error}</p>}

      {data?.view === "day" &&
        (data.day.check ? (
          <>
            <p className="mt-4 text-[12px] text-gray-500">
              Snapshot #{data.day.snapshot!.id} · {data.day.snapshot!.source === "auto" ? "15:00 auto" : "Replan"} ·{" "}
              {new Date(data.day.snapshot!.takenAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}
            </p>
            <Numbers check={data.day.check} costPct={data.day.costPct} />
            <Differences items={data.day.check.differences.map((d) => ({ ...d, days: 1 }))} week={false} />
          </>
        ) : (
          <p className="mt-6 text-[13px] text-gray-500">No load plan snapshot for {data.day.date}.</p>
        ))}

      {data?.view === "week" && (
        <>
          <Numbers check={data.week} costPct={data.costPct} days={data.week.days} />
          <Differences items={data.week.topDifferences} week />
          <h2 className="mt-8 text-[14px] font-bold text-gray-900">By day</h2>
          <table className="mt-2 w-full text-[13px] tabular-nums">
            <thead>
              <tr className="border-b border-gray-200 text-left text-gray-500">
                <th className="py-1.5 pr-3 font-medium">Date</th>
                <th className="py-1.5 pr-3 font-medium">Match</th>
                <th className="py-1.5 pr-3 font-medium">Trucks plan / actual</th>
                <th className="py-1.5 pr-3 font-medium">Not sent</th>
                <th className="py-1.5 pr-3 font-medium">Cost plan ÷ actual</th>
              </tr>
            </thead>
            <tbody>
              {data.days.map((d) => (
                <tr key={d.date} className="border-b border-gray-100">
                  <td className="py-1.5 pr-3">{d.date}</td>
                  {d.check ? (
                    <>
                      <td className="py-1.5 pr-3">{pct(d.check.bills.matchPct)}</td>
                      <td className="py-1.5 pr-3">
                        {d.check.trucks.plan.total} / {d.check.trucks.actual.total}
                      </td>
                      <td className="py-1.5 pr-3">{d.check.bills.notSent}</td>
                      <td className="py-1.5 pr-3">{pct(d.costPct)}</td>
                    </>
                  ) : (
                    <td className="py-1.5 pr-3 text-gray-400" colSpan={4}>
                      no snapshot
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

function Numbers({ check: c, costPct, days }: { check: DayCheck | WeekCheck; costPct: number | null; days?: number }) {
  const t = c.trucks;
  const rows: Array<[string, string, string]> = [
    ["Trucks — Ace", String(t.plan.ace), String(t.actual.ace)],
    ["Trucks — Big", String(t.plan.big), String(t.actual.big)],
    ["Trucks — GC", String(t.plan.gc), String(t.actual.gc)],
    ["Bulk / Direct (plan) · vehicle not known (actual)", `${t.plan.bulk} / ${t.plan.direct}`, String(t.actual.unknown)],
    ["Trucks — total", String(t.plan.total), String(t.actual.total)],
    ["Stops per truck", avg(c.stops.planSum, c.stops.planTrucks), avg(c.stops.actualSum, c.stops.actualTrucks)],
    ["Over the ideal weight (amber)", String(c.overIdeal.plan), String(c.overIdeal.actual)],
    ["Over the hard max", String(c.overHard.plan), String(c.overHard.actual)],
  ];
  return (
    <div className="mt-4 grid gap-6 md:grid-cols-[280px_1fr]">
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="text-[12px] text-gray-500">Match{days !== undefined ? ` · ${days} days with a snapshot` : ""}</div>
        <div className="text-[32px] font-extrabold tabular-nums text-gray-900">{pct(c.bills.matchPct)}</div>
        <div className="text-[12px] text-gray-500">
          {c.bills.matched} of {c.bills.judged} sent bills kept their card-mates
        </div>
        <div className="mt-3 text-[13px] text-gray-700">
          Not sent that day: <b>{c.bills.notSent}</b> of {c.bills.planned}
        </div>
        <div className="mt-1 text-[13px] text-gray-700">
          Cost, plan ÷ actual: <b>{pct(costPct)}</b>
        </div>
      </div>
      <table className="w-full text-[13px] tabular-nums">
        <thead>
          <tr className="border-b border-gray-200 text-left text-gray-500">
            <th className="py-1.5 pr-3 font-medium" />
            <th className="py-1.5 pr-3 font-medium">Plan</th>
            <th className="py-1.5 pr-3 font-medium">Actual</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, a, b]) => (
            <tr key={label} className="border-b border-gray-100">
              <td className="py-1.5 pr-3 text-gray-700">{label}</td>
              <td className="py-1.5 pr-3">{a}</td>
              <td className="py-1.5 pr-3">{b}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Differences({ items, week }: { items: Array<{ place: string; wentWith: string; plannedWith: string; days: number }>; week: boolean }) {
  return (
    <>
      <h2 className="mt-8 text-[14px] font-bold text-gray-900">{week ? "Top differences this week" : "Differences"}</h2>
      {items.length === 0 ? (
        <p className="mt-1 text-[13px] text-gray-500">None — every sent bill kept its card-mates.</p>
      ) : (
        <ul className="mt-2 space-y-1 text-[13px] text-gray-700">
          {items.map((d) => (
            <li key={`${d.place}|${d.wentWith}|${d.plannedWith}`}>
              {differenceText(d)}
              {week && <span className="text-gray-400"> · {d.days} {d.days === 1 ? "day" : "days"}</span>}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
