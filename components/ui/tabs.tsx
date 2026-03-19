"use client"

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs"
import { cn } from "@/lib/utils"

function Tabs({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return <TabsPrimitive.Root className={cn(className)} {...props} />
}

function TabsList({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn("flex border-b border-slate-200", className)}
      {...props}
    />
  )
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Tab>) {
  return (
    <TabsPrimitive.Tab
      className={cn(
        "px-4 py-2.5 text-[13px] font-medium text-slate-500 border-b-2 border-transparent -mb-px transition-colors hover:text-slate-800 outline-none",
        "data-[active]:border-[#1a237e] data-[active]:text-[#1a237e] data-[active]:font-semibold",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Panel>) {
  return (
    <TabsPrimitive.Panel
      className={cn("outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent }
