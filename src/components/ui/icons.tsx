
import { icons, type LucideProps } from "lucide-react"

import { cn } from "@/lib/utils"

type IconProps = Omit<LucideProps, "size"> & {
    name: keyof typeof icons
    size?: number
}

export function Icon({ name, size = 16, className, ...props }: IconProps) {
    const LucideIcon = icons[name]

    return <LucideIcon size={size} className={cn("size-4", className)} {...props} />
}