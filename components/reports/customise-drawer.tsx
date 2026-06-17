"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import {
  buildReportsHref,
  SECTION_OPTIONS,
  SMU_OPTIONS,
  AREA_OPTIONS,
  TREND_OPTIONS,
  type ReportParams,
} from "@/components/reports/report-params";

type Operator = { id: number; name: string | null };

// IosToggle — ON = teal-600, OFF = gray-300 (CLAUDE_UI §11).
function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`relative h-5 w-9 flex-shrink-0 rounded-full transition-colors ${on ? "bg-teal-600" : "bg-gray-300"}`}
    >
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${on ? "left-[18px]" : "left-0.5"}`} />
    </button>
  );
}

// Selectable chip — ON = teal-600 fill. Optional leading dot (area colours).
function Chip({ on, onClick, dot, children }: { on: boolean; onClick: () => void; dot?: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] font-medium transition-colors ${
        on ? "border-teal-600 bg-teal-600 text-white" : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
      }`}
    >
      {dot && <span className="h-2 w-2 rounded-full" style={{ background: on ? "#fff" : dot }} />}
      {children}
    </button>
  );
}

function toggleIn<T>(set: Set<T>, v: T): Set<T> {
  const next = new Set(set);
  if (next.has(v)) next.delete(v);
  else next.add(v);
  return next;
}

export default function CustomiseDrawer({
  open,
  onClose,
  params,
  roster,
}: {
  open: boolean;
  onClose: () => void;
  params: ReportParams;
  roster: Operator[];
}) {
  const router = useRouter();
  const allOpIds = roster.map((o) => o.id);
  const allSmu = SMU_OPTIONS as readonly string[];
  const allArea = AREA_OPTIONS.map((a) => a.value);

  // Selected-set model: [] in the URL means "all". Init full sets so unchecking
  // one yields an explicit subset; re-checking all collapses back to "all" ([]).
  const [hidden, setHidden] = useState<Set<string>>(new Set(params.hide));
  const [ops, setOps] = useState<Set<number>>(new Set(params.operators.length ? params.operators : allOpIds));
  const [includeHold, setIncludeHold] = useState(params.includeHold);
  const [smu, setSmu] = useState<Set<string>>(new Set(params.smu.length ? params.smu : allSmu));
  const [area, setArea] = useState<Set<string>>(new Set(params.area.length ? params.area : allArea));
  const [trendDays, setTrendDays] = useState(params.trendDays);

  // Re-sync from the URL each time the drawer reopens.
  useEffect(() => {
    if (!open) return;
    setHidden(new Set(params.hide));
    setOps(new Set(params.operators.length ? params.operators : allOpIds));
    setIncludeHold(params.includeHold);
    setSmu(new Set(params.smu.length ? params.smu : allSmu));
    setArea(new Set(params.area.length ? params.area : allArea));
    setTrendDays(params.trendDays);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const apply = () => {
    const next: ReportParams = {
      date: params.date,
      hide: Array.from(hidden),
      operators: ops.size === allOpIds.length ? [] : Array.from(ops),
      includeHold,
      smu: smu.size === allSmu.length ? [] : Array.from(smu),
      area: area.size === allArea.length ? [] : Array.from(area),
      trendDays,
    };
    router.push(buildReportsHref(next));
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="absolute inset-y-0 right-0 flex w-[360px] flex-col bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <div className="text-[15px] font-semibold text-gray-900">Customise report</div>
          <button type="button" onClick={onClose} className="text-gray-400 transition-colors hover:text-gray-600">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-4">
          {/* Sections */}
          <section>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400">Sections</div>
            <div className="space-y-0.5">
              {SECTION_OPTIONS.map((s) => (
                <div key={s.key} className="flex items-center justify-between py-1">
                  <span className="text-[13px] text-gray-700">{s.label}</span>
                  <Toggle on={!hidden.has(s.key)} onClick={() => setHidden((cur) => toggleIn(cur, s.key))} />
                </div>
              ))}
            </div>
          </section>

          {/* Operators */}
          {roster.length > 0 && (
            <section>
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400">Operators</div>
              <div className="flex flex-wrap gap-2">
                {roster.map((o) => (
                  <Chip key={o.id} on={ops.has(o.id)} onClick={() => setOps((cur) => toggleIn(cur, o.id))}>
                    {o.name ?? `#${o.id}`}
                  </Chip>
                ))}
              </div>
            </section>
          )}

          {/* Hold */}
          <section className="flex items-center justify-between">
            <div>
              <div className="text-[13px] font-medium text-gray-700">Show Hold OBDs</div>
              <div className="text-[11px] text-gray-400">Include OBDs on dispatch hold</div>
            </div>
            <Toggle on={includeHold} onClick={() => setIncludeHold((v) => !v)} />
          </section>

          {/* SMU */}
          <section>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400">Business unit (SMU)</div>
            <div className="flex flex-wrap gap-2">
              {SMU_OPTIONS.map((v) => (
                <Chip key={v} on={smu.has(v)} onClick={() => setSmu((cur) => toggleIn(cur, v))}>
                  {v}
                </Chip>
              ))}
            </div>
          </section>

          {/* Area */}
          <section>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400">Area / delivery type</div>
            <div className="flex flex-wrap gap-2">
              {AREA_OPTIONS.map((a) => (
                <Chip key={a.value} on={area.has(a.value)} dot={a.dot} onClick={() => setArea((cur) => toggleIn(cur, a.value))}>
                  {a.value}
                </Chip>
              ))}
            </div>
          </section>

          {/* Trend window */}
          <section>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400">Trend window</div>
            <div className="inline-flex rounded-lg border border-gray-200 p-0.5">
              {TREND_OPTIONS.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setTrendDays(d)}
                  className={`rounded-md px-3 py-1 text-[12px] font-medium transition-colors ${
                    trendDays === d ? "bg-teal-600 text-white" : "text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  {d} days
                </button>
              ))}
            </div>
          </section>
        </div>

        {/* Modal/drawer CTA = gray-900 (NOT teal). */}
        <div className="border-t border-gray-200 px-5 py-4">
          <button
            type="button"
            onClick={apply}
            className="w-full rounded-lg bg-gray-900 py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-gray-800"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
