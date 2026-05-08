// Full-screen wrapper for the attendance flow (consent + home + check-in).
// No sidebar — attendance is intentionally a focused, single-task surface.
// Centred 480px column gives a mobile feel even on desktop.

export const dynamic = "force-dynamic";

export default function AttendanceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[#f9fafb] flex items-start justify-center">
      <div className="w-full max-w-[480px] px-5 py-6">{children}</div>
    </div>
  );
}
