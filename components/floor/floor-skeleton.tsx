// Step 1 — inert loading skeleton for the Floor Control shell. No data, no
// fetching. Grey placeholder blocks only, shaped roughly like the eventual
// rail cards (left) and floor rows (right). Replaced by real panes in later
// steps. Mockup reference: docs/mockups/floor-control/01-board.html.

function RailSkeleton() {
  return (
    <div className="space-y-2 p-2.5">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="animate-pulse rounded-lg border border-gray-200 bg-white p-3"
        >
          <div className="flex items-center gap-2">
            <div className="h-3 w-24 rounded bg-gray-200" />
            <div className="ml-auto h-3 w-16 rounded bg-gray-100" />
          </div>
          <div className="mt-2.5 h-3.5 w-40 rounded bg-gray-200" />
          <div className="mt-2 h-3 w-28 rounded bg-gray-100" />
          <div className="mt-3 h-[30px] w-full rounded-md bg-gray-100" />
        </div>
      ))}
    </div>
  );
}

function FloorRowsSkeleton() {
  return (
    <div className="animate-pulse">
      {/* slot-tabs placeholder */}
      <div className="flex h-[38px] items-center gap-4 border-b border-gray-200 px-3.5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-3 w-12 rounded bg-gray-200" />
        ))}
      </div>
      {/* row placeholders */}
      <div className="divide-y divide-gray-100">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-3.5 py-3">
            <div className="h-3 w-6 rounded bg-gray-100" />
            <div className="h-3 w-24 rounded bg-gray-200" />
            <div className="h-3 w-40 rounded bg-gray-100" />
            <div className="ml-auto h-3 w-16 rounded bg-gray-100" />
            <div className="h-5 w-20 rounded bg-gray-100" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function FloorSkeleton({ variant }: { variant: "rail" | "floor" }) {
  return variant === "rail" ? <RailSkeleton /> : <FloorRowsSkeleton />;
}
