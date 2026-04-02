"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface SubSkuRow {
  id: number;
  subCode: string;
  description: string | null;
  createdAt: string;
}

interface SubSkusManagerProps {
  skuId: number;
  skuCode: string;
  skuName: string;
  initialSubSkus: SubSkuRow[];
}

export function SubSkusManager({ skuId, skuCode, skuName, initialSubSkus }: SubSkusManagerProps) {
  const [subSkus, setSubSkus] = useState<SubSkuRow[]>(initialSubSkus);
  const [subCode, setSubCode] = useState("");
  const [description, setDescription] = useState("");
  const [adding, setAdding] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!subCode.trim()) errs.subCode = "Sub-code is required.";
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setAdding(true);
    try {
      const res = await fetch(`/api/admin/skus/${skuId}/sub-skus`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subCode: subCode.trim().toUpperCase(),
          description: description.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 409) {
          setErrors({ subCode: "Sub-code already exists." });
        } else {
          toast.error(data.error ?? "Failed to add sub-SKU.");
        }
        return;
      }
      setSubSkus((prev) => [
        ...prev,
        { ...data, createdAt: data.createdAt ?? new Date().toISOString() },
      ]);
      setSubCode("");
      setDescription("");
      toast.success(`Sub-SKU "${data.subCode}" added.`);
    } catch {
      toast.error("Network error.");
    } finally {
      setAdding(false);
    }
  }

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-lg font-bold text-teal-700">Sub-SKUs</h1>
        <p className="text-sm text-gray-500 mt-1">
          {skuCode} — {skuName}
        </p>
      </div>

      {/* Add form */}
      <form onSubmit={handleAdd} className="flex flex-wrap items-end gap-3 mb-6 p-4 rounded-md border bg-white">
        <div className="space-y-1.5">
          <Label htmlFor="ss-code">Sub-Code</Label>
          <Input
            id="ss-code"
            value={subCode}
            onChange={(e) => {
              setSubCode(e.target.value.toUpperCase());
              setErrors((prev) => { const n = { ...prev }; delete n.subCode; return n; });
            }}
            placeholder="e.g. APX-4L-TIN-W"
            className="w-52"
          />
          {errors.subCode && <p className="text-xs text-destructive">{errors.subCode}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ss-desc">Description</Label>
          <Input
            id="ss-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional"
            className="w-72"
          />
        </div>
        <Button type="submit" size="sm" disabled={adding}>
          {adding ? "Adding…" : "Add Sub-SKU"}
        </Button>
      </form>

      {/* Table */}
      <div className="oa-table">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Sub-Code</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {subSkus.length === 0 && (
              <TableRow>
                <TableCell colSpan={3} className="text-center text-gray-500 py-8">
                  No sub-SKUs yet.
                </TableCell>
              </TableRow>
            )}
            {subSkus.map((s) => (
              <TableRow key={s.id}>
                <TableCell className="font-mono text-sm text-gray-700">{s.subCode}</TableCell>
                <TableCell className="text-gray-600">{s.description ?? "—"}</TableCell>
                <TableCell className="text-gray-400 text-sm">
                  {new Date(s.createdAt).toLocaleDateString("en-IN", {
                    day: "2-digit", month: "short", year: "numeric",
                  })}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
