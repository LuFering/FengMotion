import * as React from 'react'
import { Switch as SwitchPrimitive } from 'radix-ui'
import { cn } from '@/lib/utils'

/** Workbench switch: compact, token-driven, accessible. */
export function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        'peer inline-flex h-[18px] w-[32px] shrink-0 cursor-pointer items-center rounded-full border border-line bg-hole transition-colors outline-none',
        'data-[state=checked]:border-acc/60 data-[state=checked]:bg-acc/20',
        'focus-visible:ring-2 focus-visible:ring-acc/50 disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          'pointer-events-none block size-[12px] rounded-full bg-dim shadow-none transition-transform',
          'data-[state=checked]:translate-x-[16px] data-[state=checked]:bg-acc',
          'data-[state=unchecked]:translate-x-[2px]'
        )}
      />
    </SwitchPrimitive.Root>
  )
}
