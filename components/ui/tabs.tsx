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
      className={cn("flex border-b border-gray-200", className)}
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
        "px-4 py-2.5 text-[13px] font-medium text-gray-500 border-b-2 border-transparent -mb-px transition-colors hover:text-gray-800 outline-none",
        "data-[active]:border-teal-600 data-[active]:text-teal-700 data-[active]:font-semibold",
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
