Dispatch Cutoff Slots — Implementation Guide
How to apply these changes in VS Code + Claude Code

OVERVIEW OF FILES
File You Need to ChangeActionprisma/schema.prismaAdd new model + update delivery_type_masterprisma/seed.tsAdd cutoff slots seed, remove old dispatch_cutoff_timeapp/api/admin/dispatch-cutoffs/route.tsCREATE new fileapp/api/admin/dispatch-cutoffs/[id]/route.tsCREATE new fileapp/(admin)/admin/dispatch-cutoffs/page.tsxCREATE new filecomponents/admin/dispatch-cutoffs-form.tsxCREATE new filecomponents/admin/admin-sidebar.tsxAdd menu item

OPTION A — Using Claude Code (Recommended)
Claude Code runs in your terminal and edits your project files directly.
Step 1 — Install Claude Code (if not already installed)
Open your terminal and run:
npm install -g @anthropic-ai/claude-code
Step 2 — Open your project in VS Code
cd your-project-folder
code .
Step 3 — Open the VS Code integrated terminal
Press: Ctrl + (backtick)  or  Cmd + on Mac
Step 4 — Start Claude Code
In the terminal, run:
claude
Step 5 — Paste this prompt into Claude Code
Read CLAUDE_CONTEXT.md fully before doing anything.

I need to implement dispatch cutoff slots. Here are the exact changes required:

─── CHANGE 1: prisma/schema.prisma ───────────────────────────────
Find the delivery_type_master model and add a relation field:
  cutoffSlots  dispatch_cutoff_master[]

Then add this new model after delivery_type_master:

model dispatch_cutoff_master {
  id                Int                  @id @default(autoincrement())
  deliveryTypeId    Int
  deliveryType      delivery_type_master @relation(fields: [deliveryTypeId], references: [id])
  slotNumber        Int
  cutoffTime        String
  label             String
  isDefaultForType  Boolean              @default(false)
  isActive          Boolean              @default(true)
  createdAt         DateTime             @default(now())
  updatedAt         DateTime             @updatedAt

  @@unique([deliveryTypeId, slotNumber])
}

─── CHANGE 2: prisma/seed.ts ─────────────────────────────────────
1. Remove this line from the system_config array:
   { key: "dispatch_cutoff_time", value: "10:30" },

2. After the delivery_type_master seed block, add this block:

  const localType = await prisma.delivery_type_master.findUniqueOrThrow({ where: { name: "Local" } });
  const upcountryType = await prisma.delivery_type_master.findUniqueOrThrow({ where: { name: "Upcountry" } });

  const cutoffSlots = [
    { deliveryTypeId: localType.id, slotNumber: 1, label: "Morning",   cutoffTime: "", isDefaultForType: false },
    { deliveryTypeId: localType.id, slotNumber: 2, label: "Afternoon", cutoffTime: "", isDefaultForType: false },
    { deliveryTypeId: localType.id, slotNumber: 3, label: "Evening",   cutoffTime: "", isDefaultForType: false },
    { deliveryTypeId: localType.id, slotNumber: 4, label: "Night",     cutoffTime: "", isDefaultForType: false },
    { deliveryTypeId: upcountryType.id, slotNumber: 1, label: "Morning",   cutoffTime: "", isDefaultForType: false },
    { deliveryTypeId: upcountryType.id, slotNumber: 2, label: "Afternoon", cutoffTime: "", isDefaultForType: false },
    { deliveryTypeId: upcountryType.id, slotNumber: 3, label: "Evening",   cutoffTime: "", isDefaultForType: false },
    { deliveryTypeId: upcountryType.id, slotNumber: 4, label: "Night",     cutoffTime: "", isDefaultForType: true  },
  ];

  for (const slot of cutoffSlots) {
    await prisma.dispatch_cutoff_master.upsert({
      where: { deliveryTypeId_slotNumber: { deliveryTypeId: slot.deliveryTypeId, slotNumber: slot.slotNumber } },
      update: { label: slot.label, isDefaultForType: slot.isDefaultForType },
      create: slot,
    });
  }
  console.log(`  ✓ dispatch_cutoff_master — ${cutoffSlots.length} rows`);

─── CHANGE 3: CREATE app/api/admin/dispatch-cutoffs/route.ts ─────

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  requireRole(session, [ROLES.ADMIN]);
  const slots = await prisma.dispatch_cutoff_master.findMany({
    orderBy: [{ deliveryTypeId: "asc" }, { slotNumber: "asc" }],
    include: { deliveryType: true },
  });
  return NextResponse.json(slots);
}

const postSchema = z.object({
  deliveryTypeId: z.number().int().positive(),
  slotNumber: z.number().int().positive(),
  label: z.string().min(1),
  cutoffTime: z.string().regex(/^\d{2}:\d{2}$/, "Must be HH:MM format"),
  isDefaultForType: z.boolean().default(false),
});

export async function POST(req: Request) {
  const session = await auth();
  requireRole(session, [ROLES.ADMIN]);
  const body = await req.json();
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0].message }, { status: 400 });
  }
  const existing = await prisma.dispatch_cutoff_master.findUnique({
    where: { deliveryTypeId_slotNumber: { deliveryTypeId: parsed.data.deliveryTypeId, slotNumber: parsed.data.slotNumber } },
  });
  if (existing) {
    return NextResponse.json({ error: `Slot ${parsed.data.slotNumber} already exists for this delivery type.` }, { status: 409 });
  }
  const slot = await prisma.dispatch_cutoff_master.create({ data: parsed.data, include: { deliveryType: true } });
  return NextResponse.json(slot, { status: 201 });
}

─── CHANGE 4: CREATE app/api/admin/dispatch-cutoffs/[id]/route.ts ─

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  label: z.string().min(1).optional(),
  cutoffTime: z.string().regex(/^\d{2}:\d{2}$/, "Must be HH:MM format").optional(),
  isActive: z.boolean().optional(),
  isDefaultForType: z.boolean().optional(),
});

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  requireRole(session, [ROLES.ADMIN]);
  const id = parseInt(params.id);
  if (isNaN(id)) return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
  const body = await req.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.errors[0].message }, { status: 400 });
  const existing = await prisma.dispatch_cutoff_master.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Slot not found" }, { status: 404 });
  const updated = await prisma.dispatch_cutoff_master.update({ where: { id }, data: parsed.data, include: { deliveryType: true } });
  return NextResponse.json(updated);
}

─── CHANGE 5: CREATE app/(admin)/admin/dispatch-cutoffs/page.tsx ──

import { prisma } from "@/lib/prisma";
import { DispatchCutoffsForm } from "@/components/admin/dispatch-cutoffs-form";

export const dynamic = "force-dynamic";

export default async function DispatchCutoffsPage() {
  const slots = await prisma.dispatch_cutoff_master.findMany({
    orderBy: [{ deliveryTypeId: "asc" }, { slotNumber: "asc" }],
    include: { deliveryType: true },
  });
  const deliveryTypes = await prisma.delivery_type_master.findMany({ orderBy: { id: "asc" } });
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-slate-900">Dispatch Cutoff Slots</h1>
        <p className="text-sm text-slate-500 mt-1">
          Configure cutoff times for each delivery type. Disable a slot to stop order assignment to it.
        </p>
      </div>
      <DispatchCutoffsForm initialSlots={slots} deliveryTypes={deliveryTypes} />
    </div>
  );
}

─── CHANGE 6: CREATE components/admin/dispatch-cutoffs-form.tsx ───
[Paste the full content from the downloaded file: dispatch-cutoffs-form.tsx]

─── CHANGE 7: components/admin/admin-sidebar.tsx ─────────────────
Find the NAV_ITEMS array and add this entry after System Config:
  { label: "Dispatch Cutoffs", href: "/admin/dispatch-cutoffs" },

─── AFTER ALL FILES ARE CREATED ──────────────────────────────────
Run these commands in order:
1. npx prisma validate
2. npx prisma db push
3. npm run seed
4. npm run dev

Confirm each step succeeds before moving to the next.
Do not modify any other files.

OPTION B — Manual copy-paste in VS Code
If you prefer to do it manually without Claude Code:
Step 1 — Update prisma/schema.prisma

Open prisma/schema.prisma in VS Code
Find model delivery_type_master and add cutoffSlots  dispatch_cutoff_master[] inside it
After that model, paste the full dispatch_cutoff_master model from the downloaded file schema_addition.prisma

Step 2 — Update prisma/seed.ts

Open prisma/seed.ts
Remove the line: { key: "dispatch_cutoff_time", value: "10:30" },
After the delivery_type_master seed block, paste the content from seed_addition.ts

Step 3 — Create new API files

Create folder: app/api/admin/dispatch-cutoffs/
Create file: route.ts — paste content from dispatch-cutoffs_route.ts
Create folder: app/api/admin/dispatch-cutoffs/[id]/
Create file: route.ts — paste content from dispatch-cutoffs_[id]_route.ts

Step 4 — Create new page

Create folder: app/(admin)/admin/dispatch-cutoffs/
Create file: page.tsx — paste content from dispatch-cutoffs_page.tsx

Step 5 — Create new component

Open components/admin/
Create file: dispatch-cutoffs-form.tsx — paste content from dispatch-cutoffs-form.tsx

Step 6 — Update sidebar

Open components/admin/admin-sidebar.tsx
Find the NAV_ITEMS array
Add after System Config entry:
{ label: "Dispatch Cutoffs", href: "/admin/dispatch-cutoffs" },

Step 7 — Run commands
Open VS Code terminal (Ctrl+`) and run:
npx prisma validate
npx prisma db push
npm run seed
npm run dev

VERIFY IT WORKS

Go to http://localhost:3000/admin/dispatch-cutoffs
You should see 8 slots — 4 Local + 4 Upcountry
Upcountry Slot 4 should show "Default" badge
Set cutoff times by clicking each row and entering HH:MM
Click Save on each row
Toggle a slot off — it should show "Inactive" immediately
Click "Add Slot" — add a 5th slot for either delivery type