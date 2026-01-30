import { useState, useEffect, useCallback } from "react"
import { useSetAtom } from "jotai"
import { trpc } from "../../../lib/trpc"
import { Button, buttonVariants } from "../../ui/button"
import { Input } from "../../ui/input"
import { Label } from "../../ui/label"
import { Plus, Trash2, ChevronDown, Eye, EyeOff, Pencil } from "lucide-react"
import { AIPenIcon } from "../../ui/icons"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "../../ui/select"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "../../ui/alert-dialog"
import { toast } from "sonner"
import { COMMAND_PROMPTS } from "../../../features/agents/commands"
import {
  agentsSettingsDialogOpenAtom,
  selectedAgentChatIdAtom,
  selectedProjectAtom,
  agentsSettingsDialogActiveTabAtom,
} from "../../../lib/atoms"

function useIsNarrowScreen(): boolean {
  const [isNarrow, setIsNarrow] = useState(false)

  useEffect(() => {
    const checkWidth = () => {
      setIsNarrow(window.innerWidth <= 768)
    }

    checkWidth()
    window.addEventListener("resize", checkWidth)
    return () => window.removeEventListener("resize", checkWidth)
  }, [])

  return isNarrow
}

interface AgentsProjectWorktreeTabProps {
  projectId: string
}

export function AgentsProjectWorktreeTab({
  projectId,
}: AgentsProjectWorktreeTabProps) {
  const isNarrowScreen = useIsNarrowScreen()

  // Get config for selected project
  const { data: configData, refetch: refetchConfig } =
    trpc.worktreeConfig.get.useQuery(
      { projectId },
      { enabled: !!projectId },
    )

  // Save mutation
  const saveMutation = trpc.worktreeConfig.save.useMutation({
    onSuccess: () => {
      toast.success("Worktree config saved")
      refetchConfig()
    },
    onError: (err) => {
      toast.error(`Failed to save: ${err.message}`)
    },
  })

  // For "Fill with AI" - create chat and close settings
  const setSettingsDialogOpen = useSetAtom(agentsSettingsDialogOpenAtom)
  const setSelectedChatId = useSetAtom(selectedAgentChatIdAtom)
  const setSelectedProject = useSetAtom(selectedProjectAtom)
  const setSettingsActiveTab = useSetAtom(agentsSettingsDialogActiveTabAtom)
  const createChatMutation = trpc.chats.create.useMutation({
    onSuccess: (data) => {
      setSettingsDialogOpen(false)
      setSelectedChatId(data.id)
    },
  })

  // Get project info
  const { data: project } = trpc.projects.get.useQuery(
    { id: projectId },
    { enabled: !!projectId },
  )

  // Delete project mutation
  const deleteMutation = trpc.projects.delete.useMutation({
    onSuccess: () => {
      toast.success("Project removed from list")
      // Clear selected project if it's the one being deleted
      setSelectedProject((current) => {
        if (current?.id === projectId) {
          return null
        }
        return current
      })
      // Switch to account tab
      setSettingsActiveTab("account")
    },
    onError: (err) => {
      toast.error(`Failed to delete project: ${err.message}`)
    },
  })

  const [showDeleteDialog, setShowDeleteDialog] = useState(false)

  // Local state
  const [saveTarget, setSaveTarget] = useState<"cursor" | "1code">("1code")
  const [commands, setCommands] = useState<string[]>([""])
  const [unixCommands, setUnixCommands] = useState<string[]>([])
  const [windowsCommands, setWindowsCommands] = useState<string[]>([])
  const [showPlatformSpecific, setShowPlatformSpecific] = useState(false)

  // Sync from server data
  useEffect(() => {
    if (configData) {
      if (configData.source === "cursor") {
        setSaveTarget("cursor")
      } else {
        setSaveTarget("1code")
      }

      if (configData.config) {
        // Generic commands
        const generic = configData.config["setup-worktree"]
        setCommands(
          Array.isArray(generic)
            ? [...generic, ""]
            : generic
              ? [generic, ""]
              : [""],
        )

        // Platform-specific
        const unix = configData.config["setup-worktree-unix"]
        const win = configData.config["setup-worktree-windows"]

        setUnixCommands(
          Array.isArray(unix) ? unix : unix ? [unix] : [],
        )
        setWindowsCommands(
          Array.isArray(win) ? win : win ? [win] : [],
        )

        // Show platform section if any platform-specific commands exist
        if (unix || win) {
          setShowPlatformSpecific(true)
        }
      } else {
        setCommands([""])
        setUnixCommands([])
        setWindowsCommands([])
      }
    }
  }, [configData])

  const handleSave = () => {
    if (!projectId) return

    const config: Record<string, string[]> = {}
    const filteredCommands = commands.filter((c) => c.trim())
    const filteredUnix = unixCommands.filter((c) => c.trim())
    const filteredWin = windowsCommands.filter((c) => c.trim())

    if (filteredCommands.length > 0) {
      config["setup-worktree"] = filteredCommands
    }
    if (filteredUnix.length > 0) {
      config["setup-worktree-unix"] = filteredUnix
    }
    if (filteredWin.length > 0) {
      config["setup-worktree-windows"] = filteredWin
    }

    saveMutation.mutate({
      projectId,
      config,
      target: saveTarget,
    })
  }

  const updateCommand = (
    index: number,
    value: string,
    list: string[],
    setter: (v: string[]) => void,
  ) => {
    const newList = [...list]
    newList[index] = value
    setter(newList)
  }

  const removeCommand = (
    index: number,
    list: string[],
    setter: (v: string[]) => void,
  ) => {
    if (list.length <= 1) return
    setter(list.filter((_, i) => i !== index))
  }

  const addCommand = (list: string[], setter: (v: string[]) => void) => {
    setter([...list, ""])
  }

  const cursorExists = configData?.available?.cursor?.exists ?? false

  // ============ ENVIRONMENT VARIABLES ============
  const { data: envVars, refetch: refetchEnvVars } =
    trpc.projects.getEnvVars.useQuery(
      { projectId },
      { enabled: !!projectId }
    )

  const setEnvVarMutation = trpc.projects.setEnvVar.useMutation({
    onSuccess: () => {
      refetchEnvVars()
      setNewEnvKey("")
      setNewEnvValue("")
      setEditingEnvKey(null)
    },
    onError: (err) => {
      toast.error(`Failed to save: ${err.message}`)
    },
  })

  const deleteEnvVarMutation = trpc.projects.deleteEnvVar.useMutation({
    onSuccess: () => {
      refetchEnvVars()
    },
    onError: (err) => {
      toast.error(`Failed to delete: ${err.message}`)
    },
  })

  const [newEnvKey, setNewEnvKey] = useState("")
  const [newEnvValue, setNewEnvValue] = useState("")
  const [visibleEnvKeys, setVisibleEnvKeys] = useState<Set<string>>(new Set())
  const [editingEnvKey, setEditingEnvKey] = useState<string | null>(null)
  const [editValue, setEditValue] = useState("")

  const toggleEnvVisibility = useCallback((key: string) => {
    setVisibleEnvKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }, [])

  const handleAddEnvVar = useCallback(() => {
    if (!newEnvKey.trim()) return
    setEnvVarMutation.mutate({
      projectId,
      key: newEnvKey.trim(),
      value: newEnvValue,
    })
  }, [projectId, newEnvKey, newEnvValue, setEnvVarMutation])

  const handleEditEnvVar = useCallback(
    (key: string) => {
      if (envVars && envVars[key] !== undefined) {
        setEditingEnvKey(key)
        setEditValue(envVars[key])
      }
    },
    [envVars]
  )

  const handleSaveEdit = useCallback(() => {
    if (!editingEnvKey) return
    setEnvVarMutation.mutate({
      projectId,
      key: editingEnvKey,
      value: editValue,
    })
  }, [projectId, editingEnvKey, editValue, setEnvVarMutation])

  const handleDeleteEnvVar = useCallback(
    (key: string) => {
      deleteEnvVarMutation.mutate({ projectId, key })
    },
    [projectId, deleteEnvVarMutation]
  )

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      {!isNarrowScreen && (
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col space-y-1.5 text-center sm:text-left">
            <h3 className="text-sm font-semibold text-foreground">Worktree Setup</h3>
            <p className="text-xs text-muted-foreground">
              Configure setup commands that run when a new worktree is created
            </p>
          </div>
          <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 text-destructive hover:text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Remove Project
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove Project?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will remove "{project?.name}" from your project list. Your files will not be deleted.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => deleteMutation.mutate({ id: projectId })}
                  disabled={deleteMutation.isPending}
                  className={buttonVariants({ variant: "destructive" })}
                >
                  {deleteMutation.isPending ? "Removing..." : "Remove"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}

      {/* Config Location */}
      <div className="space-y-2">
        <div className="pb-2">
          <h4 className="text-sm font-medium text-foreground">
            Config Location
          </h4>
          {configData?.path && (
            <p className="text-xs text-muted-foreground mt-1">
              Using: {configData.path}
            </p>
          )}
        </div>

        <div className="bg-background rounded-lg border border-border overflow-hidden">
          <div className="p-4 flex items-center justify-between gap-6">
            <div className="flex-1">
              <Label className="text-sm font-medium">Save to</Label>
              <p className="text-xs text-muted-foreground">
                Where to save the configuration file
              </p>
            </div>
            <div className="flex-shrink-0 w-auto min-w-56 max-w-80">
              <Select
                value={saveTarget}
                onValueChange={(v) => setSaveTarget(v as "cursor" | "1code")}
              >
                <SelectTrigger className="w-full">
                  <span className="text-sm font-mono truncate">
                    {saveTarget === "cursor"
                      ? ".cursor/worktrees.json"
                      : ".1code/worktree.json"}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1code">
                    .1code/worktree.json
                  </SelectItem>
                  {cursorExists && (
                    <SelectItem value="cursor">
                      .cursor/worktrees.json
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      </div>

      {/* Setup Commands - Main */}
      <div className="space-y-2">
        <div className="pb-2 flex items-center justify-between">
          <div>
            <h4 className="text-sm font-medium text-foreground">
              Setup Commands
            </h4>
            <p className="text-xs text-muted-foreground mt-1">
              Commands run in the worktree after creation
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5"
            onClick={() => {
              const prompt = COMMAND_PROMPTS["worktree-setup"]
              if (prompt && projectId) {
                createChatMutation.mutate({
                  projectId,
                  name: "Worktree Setup",
                  initialMessageParts: [{ type: "text", text: prompt }],
                  useWorktree: false,
                  mode: "agent",
                })
              }
            }}
            disabled={!projectId || createChatMutation.isPending}
          >
            <AIPenIcon className="h-3.5 w-3.5" />
            Fill with AI
          </Button>
        </div>

        <div className="bg-background rounded-lg border border-border overflow-hidden">
          <div className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">All Platforms</Label>
              <span className="text-xs text-muted-foreground">
                use <code className="font-mono bg-muted px-1 py-0.5 rounded">$ROOT_WORKTREE_PATH</code> for main repo path
              </span>
            </div>
            <div className="space-y-2">
              {commands.map((cmd, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    value={cmd}
                    onChange={(e) =>
                      updateCommand(i, e.target.value, commands, setCommands)
                    }
                    placeholder="bun install && cp $ROOT_WORKTREE_PATH/.env .env"
                    className="flex-1 font-mono text-sm"
                  />
                  {commands.length > 1 && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={() => removeCommand(i, commands, setCommands)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-muted-foreground"
              onClick={() => addCommand(commands, setCommands)}
            >
              <Plus className="h-3.5 w-3.5" />
              Add command
            </Button>
          </div>

          {/* Platform-specific toggle */}
          <div className="border-t">
            <button
              type="button"
              className="w-full p-3 flex items-center justify-between text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
              onClick={() => setShowPlatformSpecific(!showPlatformSpecific)}
            >
              <span>Platform-specific overrides</span>
              <ChevronDown
                className={`h-4 w-4 transition-transform ${
                  showPlatformSpecific ? "rotate-180" : ""
                }`}
              />
            </button>

            {showPlatformSpecific && (
              <div className="p-4 pt-0 space-y-4">
                {/* Unix Commands */}
                <div className="space-y-2">
                  <span className="text-xs font-medium text-muted-foreground">
                    macOS / Linux
                  </span>
                  {unixCommands.length === 0 ? (
                    <p className="text-xs text-muted-foreground/60 italic">
                      Falls back to "All Platforms"
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {unixCommands.map((cmd, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <Input
                            value={cmd}
                            onChange={(e) =>
                              updateCommand(
                                i,
                                e.target.value,
                                unixCommands,
                                setUnixCommands,
                              )
                            }
                            placeholder="bun install"
                            className="flex-1 font-mono text-sm"
                          />
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            onClick={() =>
                              removeCommand(i, unixCommands, setUnixCommands)
                            }
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1.5 text-muted-foreground h-7 text-xs"
                    onClick={() => addCommand(unixCommands, setUnixCommands)}
                  >
                    <Plus className="h-3 w-3" />
                    Add
                  </Button>
                </div>

                {/* Windows Commands */}
                <div className="space-y-2">
                  <span className="text-xs font-medium text-muted-foreground">
                    Windows
                  </span>
                  {windowsCommands.length === 0 ? (
                    <p className="text-xs text-muted-foreground/60 italic">
                      Falls back to "All Platforms"
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {windowsCommands.map((cmd, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <Input
                            value={cmd}
                            onChange={(e) =>
                              updateCommand(
                                i,
                                e.target.value,
                                windowsCommands,
                                setWindowsCommands,
                              )
                            }
                            placeholder="npm ci"
                            className="flex-1 font-mono text-sm"
                          />
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            onClick={() =>
                              removeCommand(
                                i,
                                windowsCommands,
                                setWindowsCommands,
                              )
                            }
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1.5 text-muted-foreground h-7 text-xs"
                    onClick={() =>
                      addCommand(windowsCommands, setWindowsCommands)
                    }
                  >
                    <Plus className="h-3 w-3" />
                    Add
                  </Button>
                </div>
              </div>
            )}
          </div>

          <div className="bg-muted p-3 flex justify-end gap-2 border-t">
            <Button
              size="sm"
              onClick={handleSave}
              disabled={saveMutation.isPending}
            >
              {saveMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      </div>

      {/* Environment Variables */}
      <div className="space-y-2">
        <div className="pb-2">
          <h4 className="text-sm font-medium text-foreground">
            Environment Variables
          </h4>
          <p className="text-xs text-muted-foreground mt-1">
            Passed to MCP servers and Claude for this project. Stored encrypted.
          </p>
        </div>

        <div className="bg-background rounded-lg border border-border overflow-hidden">
          <div className="p-4 space-y-3">
            {/* Existing env vars */}
            {envVars && Object.keys(envVars).length > 0 && (
              <div className="space-y-2">
                {Object.entries(envVars).map(([key, value]) => (
                  <div key={key} className="flex items-center gap-2">
                    {editingEnvKey === key ? (
                      <>
                        <Input
                          value={key}
                          disabled
                          className="w-40 font-mono text-sm bg-muted"
                        />
                        <Input
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          type="text"
                          className="flex-1 font-mono text-sm"
                          placeholder="Value"
                          autoFocus
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={handleSaveEdit}
                          disabled={setEnvVarMutation.isPending}
                        >
                          Save
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditingEnvKey(null)}
                        >
                          Cancel
                        </Button>
                      </>
                    ) : (
                      <>
                        <div className="w-40 px-3 py-2 bg-muted rounded-md font-mono text-sm truncate">
                          {key}
                        </div>
                        <div className="flex-1 px-3 py-2 bg-muted/50 rounded-md font-mono text-sm truncate">
                          {visibleEnvKeys.has(key)
                            ? value
                            : "\u2022".repeat(Math.min(value.length, 20))}
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-foreground"
                          onClick={() => toggleEnvVisibility(key)}
                          title={visibleEnvKeys.has(key) ? "Hide" : "Show"}
                        >
                          {visibleEnvKeys.has(key) ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-foreground"
                          onClick={() => handleEditEnvVar(key)}
                          title="Edit"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          onClick={() => handleDeleteEnvVar(key)}
                          disabled={deleteEnvVarMutation.isPending}
                          title="Delete"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Add new env var */}
            <div className="flex items-center gap-2 pt-2 border-t border-border/50">
              <Input
                value={newEnvKey}
                onChange={(e) =>
                  setNewEnvKey(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "_"))
                }
                placeholder="KEY_NAME"
                className="w-40 font-mono text-sm"
              />
              <Input
                value={newEnvValue}
                onChange={(e) => setNewEnvValue(e.target.value)}
                type="password"
                placeholder="Value (stored encrypted)"
                className="flex-1 font-mono text-sm"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newEnvKey.trim()) {
                    handleAddEnvVar()
                  }
                }}
              />
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5"
                onClick={handleAddEnvVar}
                disabled={!newEnvKey.trim() || setEnvVarMutation.isPending}
              >
                <Plus className="h-3.5 w-3.5" />
                Add
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
