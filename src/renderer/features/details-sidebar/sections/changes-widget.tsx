"use client"

import { useCallback, useState, useEffect } from "react"
import { useAtom } from "jotai"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { ArrowUpRight, Eye } from "lucide-react"
import { DiffIcon } from "@/components/ui/icons"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { Kbd } from "@/components/ui/kbd"
import { cn } from "@/lib/utils"
import { viewedFilesAtomFamily } from "@/features/agents/atoms"
import { getStatusIndicator } from "@/features/changes/utils"
import { trpc } from "@/lib/trpc"
import type { ParsedDiffFile } from "../types"

interface ChangesWidgetProps {
  chatId: string
  worktreePath?: string | null
  diffStats?: { additions: number; deletions: number; fileCount: number } | null
  parsedFileDiffs?: ParsedDiffFile[] | null
  onCommit?: (selectedPaths: string[]) => void
  isCommitting?: boolean
  onExpand?: () => void
  /** Called when a file is clicked - should open diff sidebar with this file selected */
  onFileSelect?: (filePath: string) => void
  /** Diff display mode - affects tooltip text */
  diffDisplayMode?: "side-peek" | "center-peek" | "full-page"
}

/**
 * Get file name from path
 */
function getFileName(path: string): string {
  const parts = path.split("/")
  return parts[parts.length - 1] || path
}

/**
 * Get file directory from path
 */
function getFileDir(path: string): string {
  const parts = path.split("/")
  if (parts.length <= 1) return ""
  return parts.slice(0, -1).join("/")
}

/**
 * Map parsed diff file status to FileStatus type for getStatusIndicator
 */
function getFileStatus(file: ParsedDiffFile): "added" | "modified" | "deleted" {
  if (file.isNewFile) return "added"
  if (file.isDeletedFile) return "deleted"
  return "modified"
}

/**
 * Changes Widget for Overview Sidebar
 * Shows file list exactly like the Changes tab in diff sidebar
 */
export function ChangesWidget({
  chatId,
  worktreePath,
  diffStats,
  parsedFileDiffs,
  onCommit,
  isCommitting = false,
  onExpand,
  onFileSelect,
  diffDisplayMode = "side-peek",
}: ChangesWidgetProps) {
  const hasChanges = diffStats && diffStats.fileCount > 0

  // Get tooltip text based on diff display mode
  const expandTooltip = diffDisplayMode === "side-peek"
    ? "Open in sidebar"
    : diffDisplayMode === "center-peek"
      ? "Open in dialog"
      : "Open fullscreen"
  const files = parsedFileDiffs ?? []

  // Viewed files state (same atom as diff sidebar)
  const [viewedFiles] = useAtom(viewedFilesAtomFamily(chatId))

  // Mutations for context menu actions
  const openInFinderMutation = trpc.external.openInFinder.useMutation()

  // Selection state - all files selected by default
  const [selectedForCommit, setSelectedForCommit] = useState<Set<string>>(new Set())
  const [hasInitializedSelection, setHasInitializedSelection] = useState(false)

  // Initialize selection - select all files by default when data loads
  useEffect(() => {
    if (!hasInitializedSelection && files.length > 0) {
      const allPaths = new Set(files.map((f) => f.newPath || f.oldPath))
      setSelectedForCommit(allPaths)
      setHasInitializedSelection(true)
    }
  }, [files, hasInitializedSelection])

  // Reset selection when files change significantly
  useEffect(() => {
    if (files.length === 0) {
      setHasInitializedSelection(false)
      setSelectedForCommit(new Set())
    }
  }, [files.length])

  // Check if file is marked as viewed
  const isFileMarkedAsViewed = useCallback(
    (filePath: string): boolean => {
      const possibleKeys = [
        `${filePath}->${filePath}`, // Modified
        `/dev/null->${filePath}`, // New file
        `${filePath}->/dev/null`, // Deleted file
      ]
      for (const key of possibleKeys) {
        const viewedState = viewedFiles[key]
        if (viewedState?.viewed) {
          return true
        }
      }
      return false
    },
    [viewedFiles],
  )

  // Toggle individual file selection
  const handleCheckboxChange = useCallback((filePath: string) => {
    setSelectedForCommit((prev) => {
      const next = new Set(prev)
      if (next.has(filePath)) {
        next.delete(filePath)
      } else {
        next.add(filePath)
      }
      return next
    })
  }, [])

  // Selection stats
  const selectedCount = files.filter((f) =>
    selectedForCommit.has(f.newPath || f.oldPath),
  ).length
  const allSelected = files.length > 0 && selectedCount === files.length
  const someSelected = selectedCount > 0 && selectedCount < files.length

  // Toggle all files selection
  const handleSelectAllChange = useCallback(() => {
    if (allSelected) {
      setSelectedForCommit(new Set())
    } else {
      const allPaths = new Set(files.map((f) => f.newPath || f.oldPath))
      setSelectedForCommit(allPaths)
    }
  }, [allSelected, files])

  // Handle commit
  const handleCommit = useCallback(() => {
    const selectedPaths = files
      .filter((f) => selectedForCommit.has(f.newPath || f.oldPath))
      .map((f) => f.newPath || f.oldPath)
    onCommit?.(selectedPaths)
  }, [files, selectedForCommit, onCommit])

  return (
    <div className="mx-2 mb-2">
      <div className={cn("rounded-lg border border-border/50 overflow-hidden")}>
        {/* Widget Header with stats - fixed height h-8 for consistency */}
        <div className="flex items-center gap-2 px-2 h-8 select-none group bg-muted/30">
          {/* Icon */}
          <DiffIcon className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />

          {/* Title */}
          <span className="text-xs font-medium text-foreground">Changes</span>

          {/* Stats in header - total lines changed */}
          {hasChanges && (
            <span className="text-xs text-muted-foreground">
              <span className="text-green-500">+{diffStats.additions}</span>
              {" "}
              <span className="text-red-500">-{diffStats.deletions}</span>
            </span>
          )}

          {/* Spacer */}
          <div className="flex-1" />

          {/* Expand to sidebar button */}
          {onExpand && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onExpand}
                  className="h-5 w-5 p-0 hover:bg-foreground/10 text-muted-foreground hover:text-foreground rounded-md opacity-0 group-hover:opacity-100 transition-[background-color,opacity,transform] duration-150 ease-out active:scale-[0.97] flex-shrink-0"
                  aria-label="Expand changes"
                >
                  <ArrowUpRight className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left">
                {expandTooltip}
                <Kbd>⌘D</Kbd>
              </TooltipContent>
            </Tooltip>
          )}
        </div>

        {/* Content */}
        {hasChanges ? (
          <>
            {/* Select all header - like in changes-view */}
            <div className="flex items-center gap-2 px-2 py-1.5 border-b border-border/50">
              <Checkbox
                checked={someSelected ? "indeterminate" : allSelected}
                onCheckedChange={handleSelectAllChange}
                className="size-4 border-muted-foreground/50"
              />
              <span className="text-xs text-muted-foreground">
                {selectedCount} of {files.length} file
                {files.length !== 1 ? "s" : ""} selected
              </span>
            </div>

            {/* File list - same style as changes-view */}
            <div className="max-h-[300px] overflow-y-auto">
              {files.map((file) => {
                const filePath = file.newPath || file.oldPath
                const fileName = getFileName(filePath)
                const dirPath = getFileDir(filePath)
                const isViewed = isFileMarkedAsViewed(filePath)
                const isChecked = selectedForCommit.has(filePath)
                const status = getFileStatus(file)
                const absolutePath = worktreePath ? `${worktreePath}/${filePath}` : null

                const handleCopyPath = async () => {
                  if (absolutePath) {
                    await navigator.clipboard.writeText(absolutePath)
                  }
                }

                const handleCopyRelativePath = async () => {
                  await navigator.clipboard.writeText(filePath)
                }

                const handleRevealInFinder = () => {
                  if (absolutePath) {
                    openInFinderMutation.mutate(absolutePath)
                  }
                }

                const isUntracked = file.isNewFile

                const handleFileClick = () => {
                  if (onFileSelect) {
                    onFileSelect(filePath)
                  } else {
                    onExpand?.()
                  }
                }

                const fileRowContent = (
                  <div
                    className={cn(
                      "flex items-center gap-2 px-2 py-1 cursor-pointer",
                      "hover:bg-muted/80 transition-colors",
                    )}
                    onClick={handleFileClick}
                  >
                    {/* Checkbox for selection */}
                    <Checkbox
                      checked={isChecked}
                      onCheckedChange={() => handleCheckboxChange(filePath)}
                      onClick={(e) => e.stopPropagation()}
                      className="size-4 shrink-0 border-muted-foreground/50"
                    />

                    {/* File path - dir + name inline */}
                    <div className="flex-1 min-w-0 flex items-center overflow-hidden">
                      {dirPath && (
                        <span className="text-xs text-muted-foreground truncate flex-shrink min-w-0">
                          {dirPath}/
                        </span>
                      )}
                      <span className="text-xs font-medium flex-shrink-0 whitespace-nowrap">
                        {fileName}
                      </span>
                    </div>

                    {/* Status indicators */}
                    <div className="shrink-0 flex items-center gap-1.5">
                      {/* Viewed indicator */}
                      {isViewed && (
                        <div className="size-4 rounded bg-emerald-500/20 flex items-center justify-center">
                          <Eye className="size-2.5 text-emerald-500" />
                        </div>
                      )}
                      {/* Git status icon */}
                      {getStatusIndicator(status)}
                    </div>
                  </div>
                )

                // Without worktree path, just render the row with key
                if (!worktreePath) {
                  return <div key={file.key}>{fileRowContent}</div>
                }

                // With worktree path, wrap in context menu
                return (
                  <ContextMenu key={file.key}>
                    <ContextMenuTrigger asChild>{fileRowContent}</ContextMenuTrigger>
                    <ContextMenuContent className="w-48">
                      <ContextMenuItem onClick={handleCopyPath}>
                        Copy Path
                      </ContextMenuItem>
                      <ContextMenuItem onClick={handleCopyRelativePath}>
                        Copy Relative Path
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                      <ContextMenuItem onClick={handleRevealInFinder}>
                        Reveal in Finder
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                      <ContextMenuItem
                        className="data-[highlighted]:bg-red-500/15 data-[highlighted]:text-red-400"
                      >
                        {isUntracked ? "Delete File..." : "Discard Changes..."}
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                )
              })}
            </div>

            {/* Action buttons */}
            <div className="flex gap-2 p-2 border-t border-border/50">
              {/* Commit button */}
              {onCommit && (
                <Button
                  variant="default"
                  size="sm"
                  className="flex-1 h-7 text-xs"
                  onClick={handleCommit}
                  disabled={isCommitting || selectedCount === 0}
                >
                  {isCommitting ? "Committing..." : `Commit ${selectedCount} file${selectedCount !== 1 ? "s" : ""}`}
                </Button>
              )}

              {/* View diff button */}
              <Button
                variant="outline"
                size="sm"
                className={cn("h-7 text-xs", onCommit ? "flex-1" : "w-full")}
                onClick={() => onExpand?.()}
              >
                View Diff
              </Button>
            </div>
          </>
        ) : (
          <div className="text-xs text-muted-foreground px-2 py-2">
            No changes
          </div>
        )}
      </div>
    </div>
  )
}
