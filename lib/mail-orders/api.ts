import type { MoOrdersResponse, CustomerSearchResult } from "./types";

export function getTodayIST(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

export async function fetchMailOrders(
  date?: string,
  status?: string,
): Promise<MoOrdersResponse> {
  const d = date ?? getTodayIST();
  const params = new URLSearchParams({ date: d });
  if (status) params.set("status", status);

  const res = await fetch(`/api/mail-orders?${params.toString()}`);
  if (!res.ok) throw new Error(`Failed to fetch mail orders: ${res.status}`);
  return res.json();
}

export async function punchOrder(id: number): Promise<void> {
  const res = await fetch(`/api/mail-orders/${id}/punch`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error(`Failed to punch order: ${res.status}`);
}

export async function resolveLine(
  lineId: number,
  skuCode: string,
  saveKeyword: boolean,
): Promise<{
  success: boolean;
  propagated: number;
  matchedLines: number;
  totalLines: number;
}> {
  const res = await fetch(`/api/mail-orders/lines/${lineId}/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ skuCode, saveKeyword }),
  });
  if (!res.ok) throw new Error(`Failed to resolve line: ${res.status}`);
  return res.json();
}

export async function saveSoNumber(
  orderId: number,
  soNumber: string,
): Promise<{ success: boolean }> {
  const res = await fetch(`/api/mail-orders/${orderId}/so-number`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ soNumber }),
  });
  if (!res.ok) throw new Error("Failed to save SO number");
  return res.json();
}

export async function searchCustomers(
  query: string,
): Promise<CustomerSearchResult[]> {
  const res = await fetch(
    `/api/mail-orders/customers/search?q=${encodeURIComponent(query)}`,
  );
  if (!res.ok) throw new Error(`Failed to search customers: ${res.status}`);
  const data = await res.json();
  return data.customers;
}

export async function saveCustomer(
  orderId: number,
  data: {
    customerCode: string;
    customerName: string;
    saveKeyword?: boolean;
    keyword?: string;
    area?: string;
    deliveryType?: string;
    route?: string;
  },
): Promise<{ customerCode: string; customerName: string; customerMatchStatus: string }> {
  const res = await fetch(`/api/mail-orders/${orderId}/customer`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to save customer");
  return res.json();
}

export async function searchSkus(
  q: string,
  pack?: string,
): Promise<{ material: string; description: string; packCode: string; packMatch: boolean }[]> {
  const params = new URLSearchParams({ q });
  if (pack) params.set("pack", pack);
  const res = await fetch(
    `/api/mail-orders/skus?${params.toString()}`,
  );
  if (!res.ok) throw new Error(`Failed to search SKUs: ${res.status}`);
  const data = await res.json();
  return data.skus;
}

export async function toggleLock(
  orderId: number,
  isLocked: boolean,
): Promise<void> {
  const res = await fetch(`/api/mail-orders/${orderId}/lock`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ isLocked }),
  });
  if (!res.ok) throw new Error("Failed to toggle lock");
}

export async function saveLineStatus(
  lineId: number,
  data: {
    found: boolean;
    reason?: string;
    altSkuCode?: string;
    altSkuDescription?: string;
    note?: string;
  },
): Promise<{ success: boolean }> {
  const res = await fetch(
    `/api/mail-orders/lines/${lineId}/status`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    },
  );
  if (!res.ok) throw new Error("Failed to save line status");
  return res.json();
}
