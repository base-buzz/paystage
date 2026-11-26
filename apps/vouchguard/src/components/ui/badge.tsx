import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-deep focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-transparent bg-deep text-paper",
        secondary: "border-transparent bg-ink/5 text-ink",
        destructive: "border-transparent bg-red text-paper",
        outline: "border-ink/20 text-ink",
        gold: "border-gold/40 bg-gold/15 text-ink",
        active: "border-emerald-600/25 bg-emerald-600/10 text-emerald-700",
        expired: "border-ink/15 bg-ink/5 text-muted",
        revoked: "border-red/25 bg-red/10 text-red",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
