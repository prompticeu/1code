/**
 * Helpers for reading and writing ~/.claude.json configuration
 */
import { Mutex } from "async-mutex"
import { eq } from "drizzle-orm"
import { existsSync, readFileSync, writeFileSync } from "fs"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import { getDatabase } from "./db"
import { chats, projects } from "./db/schema"

/**
 * Mutex for protecting read-modify-write operations on ~/.claude.json
 * This prevents race conditions when multiple concurrent operations
 * (e.g., token refreshes for different MCP servers) try to update the config.
 */
const configMutex = new Mutex()

export const CLAUDE_CONFIG_PATH = path.join(os.homedir(), ".claude.json")

export interface McpServerConfig {
  command?: string
  args?: string[]
  url?: string
  authType?: "oauth" | "bearer" | "none"
  _oauth?: {
    accessToken: string
    refreshToken?: string
    clientId?: string
    expiresAt?: number
  }
  [key: string]: unknown
}

export interface ProjectConfig {
  mcpServers?: Record<string, McpServerConfig>
  [key: string]: unknown
}

export interface ClaudeConfig {
  mcpServers?: Record<string, McpServerConfig>  // User-scope (global) MCP servers
  projects?: Record<string, ProjectConfig>
  [key: string]: unknown
}

/**
 * Read ~/.claude.json asynchronously
 * Returns empty config if file doesn't exist or is invalid
 */
export async function readClaudeConfig(): Promise<ClaudeConfig> {
  try {
    const content = await fs.readFile(CLAUDE_CONFIG_PATH, "utf-8")
    return JSON.parse(content)
  } catch {
    return {}
  }
}

/**
 * Read ~/.claude.json synchronously
 * Returns empty config if file doesn't exist or is invalid
 */
export function readClaudeConfigSync(): ClaudeConfig {
  try {
    const content = readFileSync(CLAUDE_CONFIG_PATH, "utf-8")
    return JSON.parse(content)
  } catch {
    return {}
  }
}

/**
 * Write ~/.claude.json asynchronously
 */
export async function writeClaudeConfig(config: ClaudeConfig): Promise<void> {
  await fs.writeFile(CLAUDE_CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8")
}

/**
 * Write ~/.claude.json synchronously
 */
export function writeClaudeConfigSync(config: ClaudeConfig): void {
  writeFileSync(CLAUDE_CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8")
}

/**
 * Execute a read-modify-write operation on ~/.claude.json atomically.
 * This is the ONLY safe way to update the config when concurrent writes are possible.
 *
 * Uses a mutex to ensure that only one read-modify-write cycle happens at a time,
 * preventing race conditions where concurrent token refreshes could overwrite
 * each other's updates.
 *
 * @param updater Function that receives current config and returns updated config
 * @returns The updated config
 */
export async function updateClaudeConfigAtomic(
  updater: (config: ClaudeConfig) => ClaudeConfig | Promise<ClaudeConfig>
): Promise<ClaudeConfig> {
  return configMutex.runExclusive(async () => {
    const config = await readClaudeConfig()
    const updatedConfig = await updater(config)
    await writeClaudeConfig(updatedConfig)
    return updatedConfig
  })
}

/**
 * Check if ~/.claude.json exists
 */
export function claudeConfigExists(): boolean {
  return existsSync(CLAUDE_CONFIG_PATH)
}

/**
 * Get MCP servers config for a specific project
 * Automatically resolves worktree paths to original project paths
 */
export function getProjectMcpServers(
  config: ClaudeConfig,
  projectPath: string
): Record<string, McpServerConfig> | undefined {
  const resolvedPath = resolveProjectPathFromWorktree(projectPath) || projectPath
  return config.projects?.[resolvedPath]?.mcpServers
}

// Special marker for global MCP servers (not tied to a project)
export const GLOBAL_MCP_PATH = "__global__"

/**
 * Get a specific MCP server config
 * Use projectPath = GLOBAL_MCP_PATH (or null) for global MCP servers
 * Automatically resolves worktree paths to original project paths
 */
export function getMcpServerConfig(
  config: ClaudeConfig,
  projectPath: string | null,
  serverName: string
): McpServerConfig | undefined {
  // Global MCP servers (root level mcpServers in ~/.claude.json)
  if (!projectPath || projectPath === GLOBAL_MCP_PATH) {
    return config.mcpServers?.[serverName]
  }
  // Project-specific MCP servers (resolve worktree paths)
  const resolvedPath = resolveProjectPathFromWorktree(projectPath) || projectPath
  return config.projects?.[resolvedPath]?.mcpServers?.[serverName]
}

/**
 * Update MCP server config (creates path if needed)
 * Use projectPath = GLOBAL_MCP_PATH (or null) for global MCP servers
 * Automatically resolves worktree paths to original project paths
 */
export function updateMcpServerConfig(
  config: ClaudeConfig,
  projectPath: string | null,
  serverName: string,
  update: Partial<McpServerConfig>
): ClaudeConfig {
  // Global MCP servers (root level mcpServers in ~/.claude.json)
  if (!projectPath || projectPath === GLOBAL_MCP_PATH) {
    config.mcpServers = config.mcpServers || {}
    config.mcpServers[serverName] = {
      ...config.mcpServers[serverName],
      ...update,
    }
    return config
  }
  // Project-specific MCP servers (resolve worktree paths)
  const resolvedPath = resolveProjectPathFromWorktree(projectPath) || projectPath
  config.projects = config.projects || {}
  config.projects[resolvedPath] = config.projects[resolvedPath] || {}
  config.projects[resolvedPath].mcpServers = config.projects[resolvedPath].mcpServers || {}
  config.projects[resolvedPath].mcpServers[serverName] = {
    ...config.projects[resolvedPath].mcpServers[serverName],
    ...update,
  }
  return config
}

/**
 * Remove an MCP server from config
 * Use projectPath = GLOBAL_MCP_PATH (or null) for global MCP servers
 * Automatically resolves worktree paths to original project paths
 */
export function removeMcpServerConfig(
  config: ClaudeConfig,
  projectPath: string | null,
  serverName: string
): ClaudeConfig {
  // Global MCP servers
  if (!projectPath || projectPath === GLOBAL_MCP_PATH) {
    if (config.mcpServers?.[serverName]) {
      delete config.mcpServers[serverName]
    }
    return config
  }
  // Project-specific MCP servers
  const resolvedPath = resolveProjectPathFromWorktree(projectPath) || projectPath
  if (config.projects?.[resolvedPath]?.mcpServers?.[serverName]) {
    delete config.projects[resolvedPath].mcpServers[serverName]
    // Clean up empty objects
    if (Object.keys(config.projects[resolvedPath].mcpServers).length === 0) {
      delete config.projects[resolvedPath].mcpServers
    }
    if (Object.keys(config.projects[resolvedPath]).length === 0) {
      delete config.projects[resolvedPath]
    }
  }
  return config
}

/**
 * Resolve original project path from a worktree path.
 * Supports legacy (~/.21st/worktrees/{projectId}/{chatId}/) and
 * new format (~/.21st/worktrees/{projectName}/{worktreeFolder}/).
 *
 * @param pathToResolve - Either a worktree path or regular project path
 * @returns The original project path, or the input if not a worktree, or null if resolution fails
 */
export function resolveProjectPathFromWorktree(
  pathToResolve: string
): string | null {
  const worktreeMarker = path.join(".21st", "worktrees")

  // Normalize for cross-platform (handle both / and \ separators)
  const normalizedPath = pathToResolve.replace(/\\/g, "/")
  const normalizedMarker = worktreeMarker.replace(/\\/g, "/")

  if (!normalizedPath.includes(normalizedMarker)) {
    // Not a worktree path, return as-is
    return pathToResolve
  }

  try {
    // Extract segments from path structure
    // Path format: /Users/.../.21st/worktrees/{projectSlug}/{worktreeFolder}
    const worktreeBase = path.join(os.homedir(), ".21st", "worktrees")
    const normalizedBase = worktreeBase.replace(/\\/g, "/")
    const relativePath = normalizedPath
      .replace(normalizedBase, "")
      .replace(/^\//, "")

    const parts = relativePath.split("/")
    if (parts.length < 1 || !parts[0]) {
      return null
    }

    const db = getDatabase()

    // Strategy 1: Legacy lookup - folder name is a projectId
    const projectById = db
      .select({ path: projects.path })
      .from(projects)
      .where(eq(projects.id, parts[0]))
      .get()

    if (projectById) {
      return projectById.path
    }

    // Strategy 2: New format - folder name is the project name.
    // Look up via chats.worktreePath which stores the full path.
    if (parts.length >= 2) {
      const expectedWorktreePath = path.join(worktreeBase, parts[0], parts[1])
      const chat = db
        .select({ projectId: chats.projectId })
        .from(chats)
        .where(eq(chats.worktreePath, expectedWorktreePath))
        .get()

      if (chat) {
        const project = db
          .select({ path: projects.path })
          .from(projects)
          .where(eq(projects.id, chat.projectId))
          .get()

        if (project) {
          return project.path
        }
      }
    }

    return null
  } catch (error) {
    console.error("[worktree-utils] Failed to resolve project path:", error)
    return null
  }
}

/**
 * Repair incomplete MCP server configs in ~/.claude.json by copying
 * the URL and other required fields from .mcp.json files.
 * This fixes configs that were created with only OAuth tokens but missing URLs.
 */
export async function repairIncompleteMcpConfigs(): Promise<void> {
  await updateClaudeConfigAtomic(async (config) => {
    let modified = false

    // Check each project's mcpServers
    if (config.projects) {
      for (const [projectPath, projectConfig] of Object.entries(config.projects)) {
        if (!projectConfig.mcpServers) continue

        // Read .mcp.json for this project to get complete server configs
        const mcpJsonPath = path.join(projectPath, ".mcp.json")
        let mcpJsonServers: Record<string, McpServerConfig> = {}
        try {
          const content = await fs.readFile(mcpJsonPath, "utf-8")
          const mcpJson = JSON.parse(content)
          mcpJsonServers = mcpJson.mcpServers || {}
        } catch {
          // .mcp.json doesn't exist or is invalid, skip this project
          continue
        }

        // Check each server config
        for (const [serverName, serverConfig] of Object.entries(projectConfig.mcpServers)) {
          // If server has OAuth but no URL, it's incomplete
          if (serverConfig._oauth && !serverConfig.url) {
            const mcpJsonConfig = mcpJsonServers[serverName]
            if (mcpJsonConfig?.url) {
              console.log(`[MCP Repair] Copying URL for "${serverName}" from .mcp.json to ~/.claude.json`)
              // Copy the URL and type from .mcp.json
              projectConfig.mcpServers[serverName] = {
                ...mcpJsonConfig, // Copy all fields from .mcp.json (url, type, etc.)
                ...serverConfig,  // Preserve existing fields (headers, _oauth)
                url: mcpJsonConfig.url, // Ensure URL is set
                type: mcpJsonConfig.type || (mcpJsonConfig.url?.endsWith('/sse') ? 'sse' : 'http'),
              }
              modified = true
            }
          }
        }
      }
    }

    if (modified) {
      console.log(`[MCP Repair] Completed repairing incomplete MCP configs`)
    }

    return config
  })
}

/**
 * Read project-local .mcp.json file from workspace.
 * Merges OAuth tokens from ~/.claude.json if they exist (keeps secrets out of project files).
 * Returns empty object if file doesn't exist or is invalid.
 */
export async function readProjectMcpJson(
  workspacePath: string
): Promise<Record<string, McpServerConfig>> {
  const mcpJsonPath = path.join(workspacePath, ".mcp.json")
  try {
    const content = await fs.readFile(mcpJsonPath, "utf-8")
    const config = JSON.parse(content)
    const servers: Record<string, McpServerConfig> = config.mcpServers || {}

    // Merge OAuth tokens from ~/.claude.json if they exist
    // This keeps secrets out of the project's .mcp.json file
    const globalConfig = await readClaudeConfig()
    const resolvedPath = resolveProjectPathFromWorktree(workspacePath) || workspacePath
    const storedProjectServers = globalConfig.projects?.[resolvedPath]?.mcpServers || {}

    for (const [name, serverConfig] of Object.entries(servers)) {
      const storedConfig = storedProjectServers[name]
      if (storedConfig?._oauth || storedConfig?.headers) {
        // Merge OAuth tokens and headers from ~/.claude.json
        servers[name] = {
          ...serverConfig,
          ...(storedConfig._oauth && { _oauth: storedConfig._oauth }),
          headers: {
            ...(serverConfig.headers as Record<string, string> | undefined),
            ...(storedConfig.headers as Record<string, string> | undefined),
          },
        }
      }
    }

    return servers
  } catch {
    return {}
  }
}