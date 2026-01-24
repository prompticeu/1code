"use client"

import { useCallback, useEffect, useMemo, useRef } from "react"
import { IconSpinner, PlanIcon } from "@/components/ui/icons"
import { ChatMarkdownRenderer } from "@/components/chat-markdown-renderer"
import { trpc } from "@/lib/trpc"

interface PlanSectionProps {
  chatId: string
  planPath: string | null
  refetchTrigger?: number
  isExpanded?: boolean
}

export function PlanSection({
  chatId,
  planPath,
  refetchTrigger,
  isExpanded = false,
}: PlanSectionProps) {
  // Refs for scroll gradients (avoid re-renders)
  const contentRef = useRef<HTMLDivElement>(null)
  const topGradientRef = useRef<HTMLDivElement>(null)
  const bottomGradientRef = useRef<HTMLDivElement>(null)

  // Fetch plan file content using tRPC
  const {
    data: planContent,
    isLoading,
    error,
    refetch,
  } = trpc.files.readFile.useQuery({ filePath: planPath! }, { enabled: !!planPath })

  // Refetch when trigger changes
  useEffect(() => {
    if (refetchTrigger && planPath) {
      refetch()
    }
  }, [refetchTrigger, planPath, refetch])

  // Update scroll gradients via DOM (no state, no re-renders)
  const updateScrollGradients = useCallback(() => {
    const content = contentRef.current
    const topGradient = topGradientRef.current
    const bottomGradient = bottomGradientRef.current
    if (!content || !topGradient || !bottomGradient) return

    const { scrollTop, scrollHeight, clientHeight } = content
    const isScrollable = scrollHeight > clientHeight
    const isAtTop = scrollTop <= 1
    const isAtBottom = scrollTop + clientHeight >= scrollHeight - 1

    // Show top gradient when scrolled down
    topGradient.style.opacity = isScrollable && !isAtTop ? "1" : "0"
    // Show bottom gradient when not at bottom
    bottomGradient.style.opacity = isScrollable && !isAtBottom ? "1" : "0"
  }, [])

  // Update gradients on scroll
  useEffect(() => {
    const content = contentRef.current
    if (!content) return

    content.addEventListener("scroll", updateScrollGradients)
    // Initial check
    updateScrollGradients()

    return () => content.removeEventListener("scroll", updateScrollGradients)
  }, [updateScrollGradients])

  // Also update gradients when content changes
  useEffect(() => {
    updateScrollGradients()
  }, [planContent, updateScrollGradients])

  // Extract plan title from markdown (first H1)
  const planTitle = useMemo(() => {
    if (!planContent) return "Plan"
    const match = planContent.match(/^#\s+(.+)$/m)
    return match ? match[1] : "Plan"
  }, [planContent])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <IconSpinner className="h-5 w-5 text-muted-foreground" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="px-3 py-4 text-center">
        <p className="text-xs text-muted-foreground">
          Failed to load plan
        </p>
      </div>
    )
  }

  if (!planPath) {
    return (
      <div className="px-3 py-4 text-center">
        <PlanIcon className="h-8 w-8 mx-auto text-muted-foreground/50 mb-2" />
        <p className="text-xs text-muted-foreground">No plan selected</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col">
      {/* Plan content with scroll gradients */}
      <div className="relative">
        {/* Top scroll gradient - matches header bg (muted/30) */}
        <div
          ref={topGradientRef}
          className="absolute top-0 left-0 right-0 h-6 pointer-events-none z-10 transition-opacity duration-150"
          style={{
            opacity: 0,
            background:
              "linear-gradient(to bottom, color-mix(in srgb, hsl(var(--muted)) 30%, hsl(var(--background))) 0%, transparent 100%)",
          }}
        />

        <div
          ref={contentRef}
          className={`px-2 py-2 overflow-y-auto allow-text-selection ${isExpanded ? "" : "max-h-64"}`}
          data-plan-path={planPath}
        >
          <ChatMarkdownRenderer content={planContent || ""} size="sm" />
        </div>

        {/* Bottom scroll gradient */}
        <div
          ref={bottomGradientRef}
          className="absolute bottom-0 left-0 right-0 h-6 pointer-events-none z-10 transition-opacity duration-150"
          style={{
            opacity: 1,
            background:
              "linear-gradient(to top, hsl(var(--background)) 0%, transparent 100%)",
          }}
        />
      </div>
    </div>
  )
}
