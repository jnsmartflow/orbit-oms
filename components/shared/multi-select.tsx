"use client";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ChevronDown } from "lucide-react";

interface Option {
  id: number;
  name: string;
}

interface MultiSelectProps {
  options: Option[];
  selected: number[];
  onChange: (selected: number[]) => void;
  placeholder?: string;
}

export function MultiSelect({ options, selected, onChange, placeholder = "Select…" }: MultiSelectProps) {
  function toggle(id: number) {
    onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);
  }

  const label =
    selected.length === 0
      ? placeholder
      : selected.length === 1
      ? options.find((o) => o.id === selected[0])?.name ?? placeholder
      : `${selected.length} selected`;

  return (
    <Popover>
      <PopoverTrigger
        className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm hover:bg-accent hover:text-accent-foreground focus:outline-none focus:ring-1 focus:ring-ring"
      >
        <span className="truncate">{label}</span>
        <ChevronDown className="h-4 w-4 shrink-0 opacity-50 ml-2" />
      </PopoverTrigger>
      <PopoverContent className="w-64 p-2 max-h-60 overflow-y-auto">
        {options.length === 0 && (
          <p className="text-sm text-slate-500 px-2 py-1">No options available.</p>
        )}
        {options.map((opt) => (
          <div
            key={opt.id}
            className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-slate-50 cursor-pointer"
            onClick={() => toggle(opt.id)}
          >
            <Checkbox
              id={`ms-${opt.id}`}
              checked={selected.includes(opt.id)}
              onCheckedChange={() => toggle(opt.id)}
            />
            <Label htmlFor={`ms-${opt.id}`} className="cursor-pointer text-sm font-normal">
              {opt.name}
            </Label>
          </div>
        ))}
      </PopoverContent>
    </Popover>
  );
}
