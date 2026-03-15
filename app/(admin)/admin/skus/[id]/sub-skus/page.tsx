import { redirect } from "next/navigation";

// sub-skus removed in schema v10 — colour variants are separate sku_master rows
export default function SubSkusPage() {
  redirect("/admin/skus");
}
