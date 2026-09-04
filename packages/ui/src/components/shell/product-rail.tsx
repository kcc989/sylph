import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import type { LucideIcon } from "lucide-react"
import type { ReactElement, ReactNode } from "react"

export type ProductRailItem = {
  icon: LucideIcon
  label: string
  onClick?: () => void
  render?: ReactElement
  selected?: boolean
}

export type ProductRailProps = {
  account?: ReactNode
  brand: ReactNode
  items: ReadonlyArray<ProductRailItem>
  secondaryItems?: ReadonlyArray<ProductRailItem>
}

const RailItem = ({
  icon: Icon,
  label,
  onClick,
  render,
  selected,
}: ProductRailItem) => (
  <Button
    aria-label={label}
    className={cn(selected && "bg-white/[.07] text-foreground")}
    nativeButton={!render}
    onClick={onClick}
    render={render}
    size="icon-sm"
    variant="ghost"
  >
    <Icon />
  </Button>
)

export function ProductRail({
  account,
  brand,
  items,
  secondaryItems = [],
}: ProductRailProps) {
  return (
    <aside
      aria-label="Product navigation"
      className="hidden w-12 shrink-0 flex-col items-center border-r bg-surface-utility py-2.5 md:flex"
    >
      <div className="mb-4">{brand}</div>
      <nav aria-label="Product tools" className="grid gap-1">
        {items.map((item) => (
          <RailItem key={item.label} {...item} />
        ))}
      </nav>
      <div className="mt-auto grid gap-1">
        {secondaryItems.map((item) => (
          <RailItem key={item.label} {...item} />
        ))}
        {account}
      </div>
    </aside>
  )
}
