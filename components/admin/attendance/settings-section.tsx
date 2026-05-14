import type { ReactNode } from "react";

interface SettingsSectionProps {
  title: string;
  helper?: string;
  sectionError?: string | null;
  children: ReactNode;
}

export function SettingsSection({
  title,
  helper,
  sectionError,
  children,
}: SettingsSectionProps) {
  return (
    <section className="rounded-xl bg-white border border-gray-200 p-6 mb-4">
      <header className="mb-4">
        <h2 className="text-[14px] font-semibold text-gray-900">{title}</h2>
        {helper && (
          <p className="text-[11px] text-gray-500 mt-0.5">{helper}</p>
        )}
        {sectionError && (
          <div
            role="alert"
            className="mt-2 px-2 py-1 bg-red-50 border border-red-200 text-red-700 text-[11px] rounded"
          >
            {sectionError}
          </div>
        )}
      </header>
      {children}
    </section>
  );
}
