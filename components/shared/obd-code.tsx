import { cn } from "@/lib/utils";

interface ObdCodeProps {
  code: string;
  className?: string;
}

export function ObdCode({ code, className }: ObdCodeProps) {
  return (
    <span className={cn("font-mono text-[11.5px] font-medium text-[#1a237e]", className)}>
      {code}
    </span>
  );
}
