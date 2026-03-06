#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import "dotenv/config";
import * as fs from "fs";
import * as path from "path";

interface ZohoConfig {
  accessToken: string;
  portalId: string;
  portalName?: string;
  apiDomain?: string;
  refreshToken?: string;
  clientId?: string;
  clientSecret?: string;
  accountsDomain?: string;
}

class ZohoProjectsServer {
  private server: Server;
  private config: ZohoConfig;
  private baseUrl: string = "https://projectsapi.zoho.com/api/v3";
  private tokenExpiresAt: number = 0; // Unix timestamp in milliseconds

  constructor() {
    this.server = new Server(
      {
        name: "zoho-projects-mcp-server",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    // Load configuration from environment variables
    this.config = {
      accessToken: process.env.ZOHO_ACCESS_TOKEN || "",
      portalId: process.env.ZOHO_PORTAL_ID || "",
      portalName: process.env.ZOHO_PORTAL_NAME || "mtcmedialtd",
      apiDomain: process.env.ZOHO_API_DOMAIN || "https://projectsapi.zoho.com",
      refreshToken: process.env.ZOHO_REFRESH_TOKEN || "",
      clientId: process.env.ZOHO_CLIENT_ID || "",
      clientSecret: process.env.ZOHO_CLIENT_SECRET || "",
      accountsDomain: process.env.ZOHO_ACCOUNTS_DOMAIN || "https://accounts.zoho.com",
    };

    if (this.config.apiDomain) {
      this.baseUrl = `${this.config.apiDomain}/api/v3`;
    }

    // Force token refresh on first request by setting expiration to 0
    // The provided access token from config may already be expired
    this.tokenExpiresAt = 0;

    this.setupHandlers();
  }

  private async refreshAccessToken(): Promise<void> {
    if (!this.config.refreshToken || !this.config.clientId || !this.config.clientSecret) {
      console.error("Cannot refresh token: missing refresh token, client ID, or client secret");
      return;
    }

    try {
      const params = new URLSearchParams({
        refresh_token: this.config.refreshToken,
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        grant_type: "refresh_token",
      });

      const response = await fetch(`${this.config.accountsDomain}/oauth/v2/token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params.toString(),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to refresh token: ${response.status} - ${errorText}`);
      }

      const data = await response.json() as {
        access_token: string;
        expires_in: number;
      };

      // Update access token and expiration time
      this.config.accessToken = data.access_token;
      // Set expiration to 5 minutes before actual expiry for safety margin
      this.tokenExpiresAt = Date.now() + (data.expires_in - 300) * 1000;

      console.error(`Access token refreshed successfully. Expires in ${data.expires_in} seconds.`);
    } catch (error) {
      console.error(`Error refreshing access token: ${error}`);
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to refresh access token: ${error}`
      );
    }
  }

  private async makeRequest(
    endpoint: string,
    method: string = "GET",
    body?: any,
    isRetry: boolean = false
  ): Promise<any> {
    // Check if token needs refresh (5 minutes before expiry)
    if (Date.now() >= this.tokenExpiresAt) {
      await this.refreshAccessToken();
    }

    if (!this.config.accessToken) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        "Zoho access token not configured. Set ZOHO_ACCESS_TOKEN environment variable."
      );
    }

    const url = `${this.baseUrl}${endpoint}`;
    const headers: Record<string, string> = {
      Authorization: `Zoho-oauthtoken ${this.config.accessToken}`,
      "Content-Type": "application/json",
    };

    const options: {
      method: string;
      headers: Record<string, string>;
      body?: string;
    } = {
      method,
      headers,
    };

    if (body && (method === "POST" || method === "PATCH" || method === "PUT")) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);

    if (!response.ok) {
      const errorText = await response.text();

      // If 401 and we have refresh credentials and haven't retried yet, try refresh
      if (response.status === 401 && !isRetry &&
          this.config.refreshToken && this.config.clientId && this.config.clientSecret) {
        console.error("Received 401 error, attempting token refresh...");
        try {
          await this.refreshAccessToken();
          // Retry the request once with new token
          return await this.makeRequest(endpoint, method, body, true);
        } catch (refreshError) {
          console.error("Token refresh failed:", refreshError);
          // Fall through to throw original error
        }
      }

      throw new McpError(
        ErrorCode.InternalError,
        `Zoho API error: ${response.status} - ${errorText}`
      );
    }

    const text = await response.text();
    if (!text) {
      return { success: true };
    }
    return JSON.parse(text);
  }

  private setupHandlers() {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        // Portal operations
        {
          name: "list_portals",
          description: "Retrieve all Zoho Projects portals",
          inputSchema: {
            type: "object",
            properties: {},
          },
        },
        {
          name: "get_portal",
          description: "Get details of a specific portal",
          inputSchema: {
            type: "object",
            properties: {
              portal_id: { type: "string", description: "Portal ID" },
            },
            required: ["portal_id"],
          },
        },

        // Project operations
        {
          name: "list_projects",
          description: "List all projects in a portal",
          inputSchema: {
            type: "object",
            properties: {
              page: { type: "number", description: "Page number", default: 1 },
              per_page: {
                type: "number",
                description: "Items per page",
                default: 10,
              },
            },
          },
        },
        {
          name: "get_project",
          description: "Get details of a specific project",
          inputSchema: {
            type: "object",
            properties: {
              project_id: { type: "string", description: "Project ID" },
            },
            required: ["project_id"],
          },
        },
        {
          name: "create_project",
          description: "Create a new project",
          inputSchema: {
            type: "object",
            properties: {
              name: { type: "string", description: "Project name" },
              description: { type: "string", description: "Project description" },
              start_date: {
                type: "string",
                description: "Start date (YYYY-MM-DD)",
              },
              end_date: { type: "string", description: "End date (YYYY-MM-DD)" },
              is_public: {
                type: "boolean",
                description: "Is project public",
                default: false,
              },
            },
            required: ["name"],
          },
        },
        {
          name: "update_project",
          description: "Update an existing project",
          inputSchema: {
            type: "object",
            properties: {
              project_id: { type: "string", description: "Project ID" },
              name: { type: "string", description: "Project name" },
              description: { type: "string", description: "Project description" },
              start_date: {
                type: "string",
                description: "Start date (YYYY-MM-DD)",
              },
              end_date: { type: "string", description: "End date (YYYY-MM-DD)" },
              status: {
                type: "string",
                description: "Project status",
                enum: ["active", "template", "archived"],
              },
            },
            required: ["project_id"],
          },
        },
        {
          name: "delete_project",
          description: "Delete a project (moves to trash)",
          inputSchema: {
            type: "object",
            properties: {
              project_id: { type: "string", description: "Project ID" },
            },
            required: ["project_id"],
          },
        },

        // Task operations
        {
          name: "list_tasks",
          description: "List tasks from a project or portal",
          inputSchema: {
            type: "object",
            properties: {
              project_id: {
                type: "string",
                description: "Project ID (optional for portal-level)",
              },
              page: { type: "number", description: "Page number", default: 1 },
              per_page: {
                type: "number",
                description: "Items per page",
                default: 10,
              },
            },
          },
        },
        {
          name: "get_task",
          description: "Get details of a specific task",
          inputSchema: {
            type: "object",
            properties: {
              project_id: { type: "string", description: "Project ID" },
              task_id: { type: "string", description: "Task ID" },
            },
            required: ["project_id", "task_id"],
          },
        },
        {
          name: "get_task_by_prefix",
          description: "Find and get a task by its prefix/key (e.g., 'CA6-T282'). Searches through tasks to find a match.",
          inputSchema: {
            type: "object",
            properties: {
              prefix: { type: "string", description: "Task prefix/key (e.g., 'CA6-T282')" },
              project_id: {
                type: "string",
                description: "Project ID (optional, searches portal-wide if not provided)",
              },
            },
            required: ["prefix"],
          },
        },
        {
          name: "create_task",
          description: "Create a new task in a project",
          inputSchema: {
            type: "object",
            properties: {
              project_id: { type: "string", description: "Project ID" },
              name: { type: "string", description: "Task name" },
              description: { type: "string", description: "Task description. IMPORTANT: Use HTML formatting (not Markdown). Use <p>, <strong>, <ul>, <ol>, <li>, <code>, <pre> tags. Markdown will display as raw text." },
              priority: {
                type: "string",
                description: "Task priority",
                enum: ["none", "low", "medium", "high"],
              },
              start_date: {
                type: "string",
                description: "Start date (YYYY-MM-DD)",
              },
              end_date: { type: "string", description: "End date (YYYY-MM-DD)" },
              assignee_zpuid: {
                type: "string",
                description: "Assignee user ZPUID",
              },
              tasklist_id: {
                type: "string",
                description: "Tasklist ID to add the task to",
              },
              duration: {
                type: "number",
                description: "Estimated work hours for the task (e.g., 2 for 2 hours, 1.5 for 1.5 hours)",
              },
            },
            required: ["project_id", "name"],
          },
        },
        {
          name: "update_task",
          description: "Update a task",
          inputSchema: {
            type: "object",
            properties: {
              project_id: { type: "string", description: "Project ID" },
              task_id: { type: "string", description: "Task ID" },
              name: { type: "string", description: "Task name" },
              description: { type: "string", description: "Task description. IMPORTANT: Use HTML formatting (not Markdown). Use <p>, <strong>, <ul>, <ol>, <li>, <code>, <pre> tags. Markdown will display as raw text." },
              priority: {
                type: "string",
                description: "Task priority",
                enum: ["none", "low", "medium", "high"],
              },
              start_date: {
                type: "string",
                description: "Start date (YYYY-MM-DD)",
              },
              end_date: { type: "string", description: "End date (YYYY-MM-DD)" },
              status_id: { type: "string", description: "Status ID to set for the task" },
              tasklist_id: { type: "string", description: "Tasklist ID to move the task to" },
              duration: {
                type: "number",
                description: "Estimated work hours for the task (e.g., 2 for 2 hours, 1.5 for 1.5 hours)",
              },
              assignee_zpuid: {
                type: "string",
                description: "Assignee user ZPUID (from list_users)",
              },
              tag_ids: {
                type: "array",
                items: { type: "string" },
                description: "Array of tag IDs to set on the task. Use empty array [] to remove all tags. Get tag IDs from list_tags.",
              },
            },
            required: ["project_id", "task_id"],
          },
        },
        {
          name: "list_tags",
          description: "List all available tags for a project",
          inputSchema: {
            type: "object",
            properties: {
              project_id: { type: "string", description: "Project ID" },
            },
            required: ["project_id"],
          },
        },
        {
          name: "delete_task",
          description: "Delete a task",
          inputSchema: {
            type: "object",
            properties: {
              project_id: { type: "string", description: "Project ID" },
              task_id: { type: "string", description: "Task ID" },
            },
            required: ["project_id", "task_id"],
          },
        },
        {
          name: "restore_task",
          description: "Restore a deleted task from trash",
          inputSchema: {
            type: "object",
            properties: {
              project_id: { type: "string", description: "Project ID" },
              task_id: { type: "string", description: "Task ID of the deleted task to restore" },
            },
            required: ["project_id", "task_id"],
          },
        },
        {
          name: "create_tasklist",
          description: "Create a new tasklist in a project",
          inputSchema: {
            type: "object",
            properties: {
              project_id: { type: "string", description: "Project ID" },
              name: { type: "string", description: "Tasklist name" },
              milestone_id: { type: "string", description: "Milestone ID to associate the tasklist with" },
              flag: {
                type: "string",
                description: "Tasklist visibility flag",
                enum: ["internal", "external"]
              },
            },
            required: ["project_id", "name"],
          },
        },
        {
          name: "move_task",
          description: "Move a task to a different tasklist",
          inputSchema: {
            type: "object",
            properties: {
              project_id: { type: "string", description: "Project ID" },
              task_id: { type: "string", description: "Task ID" },
              tasklist_id: { type: "string", description: "Target tasklist ID to move the task to" },
            },
            required: ["project_id", "task_id", "tasklist_id"],
          },
        },
        {
          name: "delete_tasklist",
          description: "Delete a tasklist from a project",
          inputSchema: {
            type: "object",
            properties: {
              project_id: { type: "string", description: "Project ID" },
              tasklist_id: { type: "string", description: "Tasklist ID to delete" },
            },
            required: ["project_id", "tasklist_id"],
          },
        },
        {
          name: "update_tasklist",
          description: "Update a tasklist name or visibility",
          inputSchema: {
            type: "object",
            properties: {
              project_id: { type: "string", description: "Project ID" },
              tasklist_id: { type: "string", description: "Tasklist ID to update" },
              name: { type: "string", description: "New tasklist name" },
              flag: {
                type: "string",
                description: "Tasklist visibility: 'external' (visible to clients) or 'internal' (team only)",
                enum: ["internal", "external"],
              },
            },
            required: ["project_id", "tasklist_id"],
          },
        },
        {
          name: "list_subtasks",
          description: "List subtasks of a parent task",
          inputSchema: {
            type: "object",
            properties: {
              project_id: { type: "string", description: "Project ID" },
              task_id: { type: "string", description: "Parent task ID" },
              index: {
                type: "number",
                description: "Starting index for pagination (record offset, not page number)",
                default: 0,
              },
              range: {
                type: "number",
                description: "Number of subtasks to retrieve",
                default: 100,
              },
            },
            required: ["project_id", "task_id"],
          },
        },
        {
          name: "add_task_dependency",
          description: "Add a dependency between two tasks (predecessor/successor relationship)",
          inputSchema: {
            type: "object",
            properties: {
              project_id: { type: "string", description: "Project ID" },
              task_id: { type: "string", description: "Successor task ID (the task that depends on another)" },
              predecessor_id: { type: "string", description: "Predecessor task ID (the task that must complete first)" },
              dependency_type: {
                type: "string",
                description: "Type of dependency",
                enum: ["FS", "SS", "SF", "FF"],
                default: "FS",
              },
              lag_value: {
                type: "number",
                description: "Lag time between tasks",
              },
              lag_type: {
                type: "string",
                description: "Unit for lag time",
                enum: ["days", "hours"],
              },
            },
            required: ["project_id", "task_id", "predecessor_id"],
          },
        },

        // Issue operations
        {
          name: "list_issues",
          description: "List issues from a project or portal",
          inputSchema: {
            type: "object",
            properties: {
              project_id: {
                type: "string",
                description: "Project ID (optional for portal-level)",
              },
              page: { type: "number", description: "Page number", default: 1 },
              per_page: {
                type: "number",
                description: "Items per page",
                default: 10,
              },
            },
          },
        },
        {
          name: "get_issue",
          description: "Get details of a specific issue",
          inputSchema: {
            type: "object",
            properties: {
              project_id: { type: "string", description: "Project ID" },
              issue_id: { type: "string", description: "Issue ID" },
            },
            required: ["project_id", "issue_id"],
          },
        },
        {
          name: "create_issue",
          description: "Create a new issue",
          inputSchema: {
            type: "object",
            properties: {
              project_id: { type: "string", description: "Project ID" },
              title: { type: "string", description: "Issue title" },
              description: { type: "string", description: "Issue description" },
              severity: {
                type: "string",
                description: "Issue severity",
                enum: ["minor", "major", "critical"],
              },
              due_date: { type: "string", description: "Due date (YYYY-MM-DD)" },
            },
            required: ["project_id", "title"],
          },
        },
        {
          name: "update_issue",
          description: "Update an issue",
          inputSchema: {
            type: "object",
            properties: {
              project_id: { type: "string", description: "Project ID" },
              issue_id: { type: "string", description: "Issue ID" },
              title: { type: "string", description: "Issue title" },
              description: { type: "string", description: "Issue description" },
              severity: {
                type: "string",
                description: "Issue severity",
                enum: ["minor", "major", "critical"],
              },
            },
            required: ["project_id", "issue_id"],
          },
        },

        // Milestone/Phase operations
        {
          name: "list_phases",
          description: "List phases/milestones from a project",
          inputSchema: {
            type: "object",
            properties: {
              project_id: { type: "string", description: "Project ID" },
              page: { type: "number", description: "Page number", default: 1 },
              per_page: {
                type: "number",
                description: "Items per page",
                default: 10,
              },
            },
            required: ["project_id"],
          },
        },
        {
          name: "create_phase",
          description: "Create a new phase/milestone",
          inputSchema: {
            type: "object",
            properties: {
              project_id: { type: "string", description: "Project ID" },
              name: { type: "string", description: "Phase name" },
              start_date: {
                type: "string",
                description: "Start date (YYYY-MM-DD)",
              },
              end_date: { type: "string", description: "End date (YYYY-MM-DD)" },
              owner_zuid: { type: "string", description: "Owner user ZUID (numeric ID from list_users)" },
            },
            required: ["project_id", "name"],
          },
        },
        {
          name: "update_phase",
          description: "Update a phase/milestone. IMPORTANT: start_date and end_date are required by the Zoho REST API for updates.",
          inputSchema: {
            type: "object",
            properties: {
              project_id: { type: "string", description: "Project ID" },
              phase_id: { type: "string", description: "Phase/Milestone ID" },
              name: { type: "string", description: "Phase name" },
              start_date: {
                type: "string",
                description: "Start date (YYYY-MM-DD)",
              },
              end_date: { type: "string", description: "End date (YYYY-MM-DD)" },
              owner_zuid: { type: "string", description: "Owner user ZUID (numeric ID from list_users)" },
              status: {
                type: "string",
                description: "Phase status",
                enum: ["active", "completed"],
              },
            },
            required: ["project_id", "phase_id"],
          },
        },
        {
          name: "delete_phase",
          description: "Delete a phase/milestone from a project",
          inputSchema: {
            type: "object",
            properties: {
              project_id: { type: "string", description: "Project ID" },
              phase_id: { type: "string", description: "Phase/Milestone ID to delete" },
            },
            required: ["project_id", "phase_id"],
          },
        },

        // Search
        {
          name: "search",
          description: "Search across portal or project",
          inputSchema: {
            type: "object",
            properties: {
              search_term: {
                type: "string",
                description: "Search term/query",
              },
              project_id: {
                type: "string",
                description: "Project ID (optional for portal-level search)",
              },
              module: {
                type: "string",
                description: "Module to search in",
                enum: [
                  "all",
                  "projects",
                  "tasks",
                  "issues",
                  "milestones",
                  "forums",
                  "events",
                ],
              },
              page: { type: "number", description: "Page number", default: 1 },
              per_page: {
                type: "number",
                description: "Items per page",
                default: 10,
              },
            },
            required: ["search_term"],
          },
        },

        // Users
        {
          name: "list_users",
          description: "List users in a portal or project",
          inputSchema: {
            type: "object",
            properties: {
              project_id: {
                type: "string",
                description: "Project ID (optional for portal-level)",
              },
            },
          },
        },
        {
          name: "get_my_tasks",
          description: "Get tasks assigned to the current user across all projects in the portal",
          inputSchema: {
            type: "object",
            properties: {
              index: {
                type: "number",
                description: "Starting index for pagination (record offset, not page number)",
                default: 0,
              },
              range: {
                type: "number",
                description: "Number of tasks to retrieve",
                default: 100,
              },
            },
          },
        },

        // Task Statuses
        {
          name: "list_statuses",
          description: "List available task statuses for a project",
          inputSchema: {
            type: "object",
            properties: {
              project_id: { type: "string", description: "Project ID" },
            },
            required: ["project_id"],
          },
        },

        // Task Comments
        {
          name: "list_task_comments",
          description: "List comments on a task",
          inputSchema: {
            type: "object",
            properties: {
              project_id: { type: "string", description: "Project ID" },
              task_id: { type: "string", description: "Task ID" },
              page: { type: "number", description: "Page number", default: 1 },
              per_page: {
                type: "number",
                description: "Items per page",
                default: 10,
              },
            },
            required: ["project_id", "task_id"],
          },
        },
        {
          name: "add_task_comment",
          description: "Add a comment to a task",
          inputSchema: {
            type: "object",
            properties: {
              project_id: { type: "string", description: "Project ID" },
              task_id: { type: "string", description: "Task ID" },
              content: { type: "string", description: "Comment text content" },
            },
            required: ["project_id", "task_id", "content"],
          },
        },
        {
          name: "edit_task_comment",
          description: "Edit an existing comment on a task",
          inputSchema: {
            type: "object",
            properties: {
              project_id: { type: "string", description: "Project ID" },
              task_id: { type: "string", description: "Task ID" },
              comment_id: { type: "string", description: "Comment ID to edit" },
              content: { type: "string", description: "New comment text content" },
            },
            required: ["project_id", "task_id", "comment_id", "content"],
          },
        },
        {
          name: "delete_task_comment",
          description: "Delete a comment from a task",
          inputSchema: {
            type: "object",
            properties: {
              project_id: { type: "string", description: "Project ID" },
              task_id: { type: "string", description: "Task ID" },
              comment_id: { type: "string", description: "Comment ID to delete" },
            },
            required: ["project_id", "task_id", "comment_id"],
          },
        },
        {
          name: "upload_task_attachment",
          description: "Upload a file attachment to a task",
          inputSchema: {
            type: "object",
            properties: {
              project_id: { type: "string", description: "Project ID" },
              task_id: { type: "string", description: "Task ID" },
              file_path: { type: "string", description: "Absolute path to file to upload" },
              file_name: { type: "string", description: "Optional: Override filename for the attachment" },
            },
            required: ["project_id", "task_id", "file_path"],
          },
        },
        {
          name: "list_task_attachments",
          description: "List attachments on a task",
          inputSchema: {
            type: "object",
            properties: {
              project_id: { type: "string", description: "Project ID" },
              task_id: { type: "string", description: "Task ID" },
            },
            required: ["project_id", "task_id"],
          },
        },
        {
          name: "delete_task_attachment",
          description: "Delete an attachment from a task. For WorkDrive attachments, use the third_party_file_id as the attachment_id.",
          inputSchema: {
            type: "object",
            properties: {
              project_id: { type: "string", description: "Project ID" },
              task_id: { type: "string", description: "Task ID" },
              attachment_id: { type: "string", description: "Attachment ID (or third_party_file_id for WorkDrive files)" },
            },
            required: ["project_id", "task_id", "attachment_id"],
          },
        },
        {
          name: "download_inline_image",
          description: "Download an inline image from a Zoho task description URL to a local file. Use this to download screenshots/images embedded in task descriptions.",
          inputSchema: {
            type: "object",
            properties: {
              image_url: {
                type: "string",
                description: "The Zoho inline image URL (e.g., https://projects.zoho.com/viewInlineAttachmentForApi/image?file=...)"
              },
              output_path: {
                type: "string",
                description: "Absolute path where the image should be saved (e.g., /path/to/image.png)"
              },
            },
            required: ["image_url", "output_path"],
          },
        },
        {
          name: "extract_inline_images",
          description: "Extract all inline image URLs from a task description HTML. Returns a list of Zoho image URLs that can be downloaded.",
          inputSchema: {
            type: "object",
            properties: {
              html: {
                type: "string",
                description: "The task description HTML to extract image URLs from"
              },
            },
            required: ["html"],
          },
        },
        {
          name: "download_task_images",
          description: "Download all inline images from a task description to a local directory. Returns the mapping of original URLs to local file paths.",
          inputSchema: {
            type: "object",
            properties: {
              project_id: { type: "string", description: "Project ID" },
              task_id: { type: "string", description: "Task ID" },
              output_dir: {
                type: "string",
                description: "Absolute path to directory where images should be saved"
              },
            },
            required: ["project_id", "task_id", "output_dir"],
          },
        },
        {
          name: "export_project",
          description: "Export an entire Zoho project to a local directory. Creates a portable export with project.json containing all data and an images/ folder with downloaded attachments. Use this for importing projects into other systems.",
          inputSchema: {
            type: "object",
            properties: {
              project_id: { type: "string", description: "Zoho Project ID to export" },
              output_dir: {
                type: "string",
                description: "Absolute path to directory where export should be saved. Will create project.json and images/ subfolder."
              },
              include_images: {
                type: "boolean",
                description: "Whether to download inline images from task descriptions (default: true)",
                default: true
              },
            },
            required: ["project_id", "output_dir"],
          },
        },
      ],
    }));

    // Handle tool execution
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      // Cast args to any since JSON schema validation handles type safety
      const params = (args || {}) as any;

      try {
        switch (name) {
          // Portal operations
          case "list_portals":
            return await this.listPortals();
          case "get_portal":
            return await this.getPortal(params.portal_id);

          // Project operations
          case "list_projects":
            return await this.listProjects(params.page, params.per_page);
          case "get_project":
            return await this.getProject(params.project_id);
          case "create_project":
            return await this.createProject(params);
          case "update_project":
            return await this.updateProject(params);
          case "delete_project":
            return await this.deleteProject(params.project_id);

          // Task operations
          case "list_tasks":
            return await this.listTasks(params.project_id, params.page, params.per_page);
          case "get_task":
            return await this.getTask(params.project_id, params.task_id);
          case "get_task_by_prefix":
            return await this.getTaskByPrefix(params.prefix, params.project_id);
          case "create_task":
            return await this.createTask(params);
          case "update_task":
            return await this.updateTask(params);
          case "delete_task":
            return await this.deleteTask(params.project_id, params.task_id);
          case "restore_task":
            return await this.restoreTask(params.project_id, params.task_id);
          case "create_tasklist":
            return await this.createTasklist(params);
          case "move_task":
            return await this.moveTask(params.project_id, params.task_id, params.tasklist_id);
          case "delete_tasklist":
            return await this.deleteTasklist(params.project_id, params.tasklist_id);
          case "update_tasklist":
            return await this.updateTasklist(params.project_id, params.tasklist_id, params.name, params.flag);
          case "list_subtasks":
            return await this.listSubtasks(params.project_id, params.task_id, params.index, params.range);
          case "add_task_dependency":
            return await this.addTaskDependency(params.project_id, params.task_id, params.predecessor_id, params.dependency_type, params.lag_value, params.lag_type);

          // Issue operations
          case "list_issues":
            return await this.listIssues(params.project_id, params.page, params.per_page);
          case "get_issue":
            return await this.getIssue(params.project_id, params.issue_id);
          case "create_issue":
            return await this.createIssue(params);
          case "update_issue":
            return await this.updateIssue(params);

          // Phase operations
          case "list_phases":
            return await this.listPhases(params.project_id, params.page, params.per_page);
          case "create_phase":
            return await this.createPhase(params);
          case "update_phase":
            return await this.updatePhase(params);
          case "delete_phase":
            return await this.deletePhase(params.project_id, params.phase_id);

          // Search
          case "search":
            return await this.search(params);

          // Users
          case "list_users":
            return await this.listUsers(params.project_id);
          case "get_my_tasks":
            return await this.getMyTasks(params.index, params.range);

          // Task Statuses
          case "list_statuses":
            return await this.listStatuses(params.project_id);

          // Tags
          case "list_tags":
            return await this.listTags(params.project_id);

          // Task Comments
          case "list_task_comments":
            return await this.listTaskComments(params.project_id, params.task_id, params.page, params.per_page);
          case "add_task_comment":
            return await this.addTaskComment(params.project_id, params.task_id, params.content);
          case "edit_task_comment":
            return await this.editTaskComment(params.project_id, params.task_id, params.comment_id, params.content);
          case "delete_task_comment":
            return await this.deleteTaskComment(params.project_id, params.task_id, params.comment_id);
          case "upload_task_attachment":
            return await this.uploadTaskAttachment(params.project_id, params.task_id, params.file_path, params.file_name);
          case "list_task_attachments":
            return await this.listTaskAttachments(params.project_id, params.task_id);
          case "delete_task_attachment":
            return await this.deleteTaskAttachment(params.project_id, params.task_id, params.attachment_id);
          case "download_inline_image":
            return await this.downloadInlineImage(params.image_url, params.output_path);
          case "extract_inline_images":
            return await this.extractInlineImages(params.html);
          case "download_task_images":
            return await this.downloadTaskImages(params.project_id, params.task_id, params.output_dir);
          case "export_project":
            return await this.exportProject(params.project_id, params.output_dir, params.include_images ?? true);

          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${name}`
            );
        }
      } catch (error) {
        if (error instanceof McpError) throw error;
        throw new McpError(
          ErrorCode.InternalError,
          `Error executing ${name}: ${error}`
        );
      }
    });
  }

  // Portal operations
  private async listPortals() {
    const data = await this.makeRequest("/portals");
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }

  private async getPortal(portalId: string) {
    const data = await this.makeRequest(`/portal/${portalId}`);
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }

  // Project operations
  private async listProjects(page: number = 1, perPage: number = 10) {
    const data = await this.makeRequest(
      `/portal/${this.config.portalId}/projects?page=${page}&per_page=${perPage}`
    );
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }

  private async getProject(projectId: string) {
    const data = await this.makeRequest(
      `/portal/${this.config.portalId}/projects/${projectId}`
    );
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }

  private async createProject(params: any) {
    const data = await this.makeRequest(
      `/portal/${this.config.portalId}/projects`,
      "POST",
      params
    );
    return {
      content: [
        {
          type: "text",
          text: `Project created successfully:\n${JSON.stringify(data, null, 2)}`,
        },
      ],
    };
  }

  private async updateProject(params: any) {
    const { project_id, ...updateData } = params;
    const data = await this.makeRequest(
      `/portal/${this.config.portalId}/projects/${project_id}`,
      "PATCH",
      updateData
    );
    return {
      content: [
        {
          type: "text",
          text: `Project updated successfully:\n${JSON.stringify(data, null, 2)}`,
        },
      ],
    };
  }

  private async deleteProject(projectId: string) {
    const data = await this.makeRequest(
      `/portal/${this.config.portalId}/projects/${projectId}/trash`,
      "POST"
    );
    return {
      content: [
        {
          type: "text",
          text: `Project moved to trash successfully:\n${JSON.stringify(data, null, 2)}`,
        },
      ],
    };
  }

  // Task operations
  private async listTasks(
    projectId?: string,
    page: number = 1,
    perPage: number = 10
  ) {
    const endpoint = projectId
      ? `/portal/${this.config.portalId}/projects/${projectId}/tasks?page=${page}&per_page=${perPage}`
      : `/portal/${this.config.portalId}/tasks?page=${page}&per_page=${perPage}`;
    const data = await this.makeRequest(endpoint);
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }

  private async getTask(projectId: string, taskId: string) {
    const data = await this.makeRequest(
      `/portal/${this.config.portalId}/projects/${projectId}/tasks/${taskId}`
    );
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }

  private async getTaskByPrefix(prefix: string, projectId?: string) {
    const normalizedPrefix = prefix.toUpperCase().trim();

    // Use REST API search endpoint (not v3) - it supports searching by task prefix/key
    const restBaseUrl = (this.config.apiDomain || 'https://projectsapi.zoho.com').replace('/api/v3', '');

    // Refresh token if needed
    if (Date.now() >= this.tokenExpiresAt) {
      await this.refreshAccessToken();
    }

    // Strategy 1: Try project-level search if we have a project ID
    if (projectId) {
      try {
        const searchEndpoint = `${restBaseUrl}/restapi/portal/${this.config.portalId}/projects/${projectId}/search?search_term=${encodeURIComponent(normalizedPrefix)}&module=tasks&index=0&range=50`;

        const response = await fetch(searchEndpoint, {
          method: 'GET',
          headers: {
            'Authorization': `Zoho-oauthtoken ${this.config.accessToken}`,
            'Content-Type': 'application/json',
          },
        });

        if (response.ok) {
          const searchData = await response.json() as { search_results?: any[]; tasks?: any[] };
          const searchResults = searchData.search_results || searchData.tasks || [];

          for (const result of searchResults) {
            const taskPrefix = (result.key || result.prefix || '').toUpperCase();
            if (taskPrefix === normalizedPrefix) {
              // Found it! Get full task details via v3 API
              // Use id_string to avoid JavaScript precision issues with large numeric IDs
              const taskId = result.id_string || result.id;
              if (taskId) {
                const fullTask = await this.makeRequest(
                  `/portal/${this.config.portalId}/projects/${projectId}/tasks/${taskId}`
                );
                return {
                  content: [{ type: "text", text: JSON.stringify(fullTask, null, 2) }],
                };
              }
              return {
                content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
              };
            }
          }
        }
      } catch (searchError) {
        console.error("Project-level search failed:", searchError);
      }
    }

    // Strategy 2: Try portal-level search
    try {
      const searchEndpoint = `${restBaseUrl}/restapi/portal/${this.config.portalId}/search?search_term=${encodeURIComponent(normalizedPrefix)}&module=tasks&index=0&range=50`;
      console.error(`[get_task_by_prefix] Searching portal: ${searchEndpoint}`);

      const response = await fetch(searchEndpoint, {
        method: 'GET',
        headers: {
          'Authorization': `Zoho-oauthtoken ${this.config.accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      console.error(`[get_task_by_prefix] Search response status: ${response.status}`);

      if (response.ok) {
        const searchData = await response.json() as { search_results?: any[]; tasks?: any[]; tasks_count?: number };
        const searchResults = searchData.search_results || searchData.tasks || [];
        console.error(`[get_task_by_prefix] Found ${searchResults.length} results (tasks_count: ${searchData.tasks_count})`);

        for (const result of searchResults) {
          const taskPrefix = (result.key || result.prefix || '').toUpperCase();
          console.error(`[get_task_by_prefix] Checking result: key="${result.key}", prefix="${result.prefix}", normalized="${taskPrefix}" vs searching for "${normalizedPrefix}"`);
          if (taskPrefix === normalizedPrefix) {
            // Found it! Get full task details via v3 API
            // Use id_string to avoid JavaScript precision issues with large numeric IDs
            const taskProjectId = result.project?.id_string || result.project?.id || result.project_id;
            const taskId = result.id_string || result.id;
            console.error(`[get_task_by_prefix] Match found! projectId=${taskProjectId}, taskId=${taskId}`);
            if (taskProjectId && taskId) {
              const fullTask = await this.makeRequest(
                `/portal/${this.config.portalId}/projects/${taskProjectId}/tasks/${taskId}`
              );
              return {
                content: [{ type: "text", text: JSON.stringify(fullTask, null, 2) }],
              };
            }
            return {
              content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            };
          }
        }
        console.error(`[get_task_by_prefix] No match found in search results`);
      } else {
        const errorText = await response.text();
        console.error(`[get_task_by_prefix] Search failed: ${response.status} - ${errorText}`);
      }
    } catch (searchError) {
      console.error("Portal-level search failed:", searchError);
    }

    // Strategy 3: Fall back to paginated task listing (slower but comprehensive)
    const perPage = 100;
    let page = 1;
    const maxPages = 50;

    while (page <= maxPages) {
      const endpoint = projectId
        ? `/portal/${this.config.portalId}/projects/${projectId}/tasks?page=${page}&per_page=${perPage}`
        : `/portal/${this.config.portalId}/tasks?page=${page}&per_page=${perPage}`;

      const data = await this.makeRequest(endpoint);
      const tasks = data.tasks || [];

      for (const task of tasks) {
        const taskPrefix = (task.prefix || task.key || '').toUpperCase();
        if (taskPrefix === normalizedPrefix) {
          const taskProjectId = projectId || task.project?.id;
          if (taskProjectId) {
            const fullTask = await this.makeRequest(
              `/portal/${this.config.portalId}/projects/${taskProjectId}/tasks/${task.id}`
            );
            return {
              content: [{ type: "text", text: JSON.stringify(fullTask, null, 2) }],
            };
          }
          return {
            content: [{ type: "text", text: JSON.stringify(task, null, 2) }],
          };
        }
      }

      const pageInfo = data.page_info;
      if (!pageInfo?.has_next_page || tasks.length === 0) {
        break;
      }
      page++;
    }

    throw new McpError(
      ErrorCode.InvalidRequest,
      `Task with prefix '${prefix}' not found${projectId ? ` in project ${projectId}` : ' in portal'}. Searched via REST API and ${page} pages of tasks.`
    );
  }

  private async createTask(params: any) {
    const { project_id, tasklist_id, assignee_zpuid, ...taskData } = params;
    // Map tasklist_id to tasklist for the API
    if (tasklist_id) {
      taskData.tasklist = { id: tasklist_id };
    }
    // Map assignee_zpuid to owners_and_work.owners for the v3 API
    if (assignee_zpuid) {
      taskData.owners_and_work = {
        owners: [{ zpuid: assignee_zpuid }]
      };
    }
    // Convert duration to object format expected by API (HH:MM format for hours)
    if (taskData.duration !== undefined) {
      const hours = Math.floor(Number(taskData.duration));
      const minutes = Math.round((Number(taskData.duration) - hours) * 60);
      const durationValue = `${hours}:${minutes.toString().padStart(2, '0')}`;
      const durationType = taskData.duration_type || "hours";
      delete taskData.duration_type;
      taskData.duration = {
        value: durationValue,
        type: durationType
      };
    }
    const data = await this.makeRequest(
      `/portal/${this.config.portalId}/projects/${project_id}/tasks`,
      "POST",
      taskData
    );
    return {
      content: [
        {
          type: "text",
          text: `Task created successfully:\n${JSON.stringify(data, null, 2)}`,
        },
      ],
    };
  }

  private async updateTask(params: any) {
    const { project_id, task_id, status_id, tasklist_id, assignee_zpuid, tag_ids, ...taskData } = params;
    // Map status_id to status for the API
    if (status_id) {
      taskData.status = { id: status_id };
    }
    // Map tasklist_id to tasklist for the API
    if (tasklist_id) {
      taskData.tasklist = { id: tasklist_id };
    }
    // Map assignee_zpuid to owners_and_work.owners for the v3 API
    if (assignee_zpuid) {
      taskData.owners_and_work = {
        owners: [{ zpuid: assignee_zpuid }]
      };
    }
    // Map tag_ids to tags array for the API
    if (tag_ids !== undefined) {
      taskData.tags = tag_ids.map((id: string) => ({ id }));
    }
    // Convert duration to object format expected by API (HH:MM format for hours)
    if (taskData.duration !== undefined) {
      const hours = Math.floor(Number(taskData.duration));
      const minutes = Math.round((Number(taskData.duration) - hours) * 60);
      const durationValue = `${hours}:${minutes.toString().padStart(2, '0')}`;
      const durationType = taskData.duration_type || "hours";
      delete taskData.duration_type;
      taskData.duration = {
        value: durationValue,
        type: durationType
      };
    }
    const data = await this.makeRequest(
      `/portal/${this.config.portalId}/projects/${project_id}/tasks/${task_id}`,
      "PATCH",
      taskData
    );
    return {
      content: [
        {
          type: "text",
          text: `Task updated successfully:\n${JSON.stringify(data, null, 2)}`,
        },
      ],
    };
  }

  private async deleteTask(projectId: string, taskId: string) {
    const data = await this.makeRequest(
      `/portal/${this.config.portalId}/projects/${projectId}/tasks/${taskId}`,
      "DELETE"
    );
    return {
      content: [
        {
          type: "text",
          text: `Task deleted successfully:\n${JSON.stringify(data, null, 2)}`,
        },
      ],
    };
  }

  private async restoreTask(projectId: string, taskId: string) {
    // Use REST API endpoint for restoring tasks from trash
    const restBaseUrl = (this.config.apiDomain || 'https://projectsapi.zoho.com').replace('/api/v3', '');

    // Refresh token if needed
    if (Date.now() >= this.tokenExpiresAt) {
      await this.refreshAccessToken();
    }

    // Try multiple possible endpoints for restoring from trash
    const endpoints = [
      `${restBaseUrl}/restapi/portal/${this.config.portalId}/trash/restore/`,
      `${restBaseUrl}/restapi/portal/${this.config.portalId}/projects/${projectId}/trash/restore/`,
    ];

    let lastError = '';

    for (const url of endpoints) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Authorization': `Zoho-oauthtoken ${this.config.accessToken}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: `module=tasks&id=${taskId}`,
        });

        if (response.ok) {
          const text = await response.text();
          const data = text ? JSON.parse(text) : { success: true };
          return {
            content: [
              {
                type: "text",
                text: `Task restored successfully:\n${JSON.stringify(data, null, 2)}`,
              },
            ],
          };
        } else {
          lastError = `${url}: ${response.status} - ${await response.text()}`;
        }
      } catch (e) {
        lastError = `${url}: ${e}`;
      }
    }

    throw new McpError(
      ErrorCode.InternalError,
      `Failed to restore task. Tried multiple endpoints. Last error: ${lastError}`
    );
  }

  private async createTasklist(params: any) {
    const { project_id, milestone_id, ...tasklistData } = params;
    // Map milestone_id to milestone for the API
    if (milestone_id) {
      tasklistData.milestone = { id: milestone_id };
    }
    const data = await this.makeRequest(
      `/portal/${this.config.portalId}/projects/${project_id}/tasklists`,
      "POST",
      tasklistData
    );
    return {
      content: [
        {
          type: "text",
          text: `Tasklist created successfully:\n${JSON.stringify(data, null, 2)}`,
        },
      ],
    };
  }

  private async moveTask(projectId: string, taskId: string, tasklistId: string) {
    const data = await this.makeRequest(
      `/portal/${this.config.portalId}/projects/${projectId}/tasks/${taskId}/move`,
      "POST",
      { target_tasklist_id: tasklistId }
    );
    return {
      content: [
        {
          type: "text",
          text: `Task moved successfully:\n${JSON.stringify(data, null, 2)}`,
        },
      ],
    };
  }

  private async deleteTasklist(projectId: string, tasklistId: string) {
    const data = await this.makeRequest(
      `/portal/${this.config.portalId}/projects/${projectId}/tasklists/${tasklistId}`,
      "DELETE"
    );
    return {
      content: [
        {
          type: "text",
          text: `Tasklist deleted successfully:\n${JSON.stringify(data, null, 2)}`,
        },
      ],
    };
  }

  private async updateTasklist(projectId: string, tasklistId: string, name?: string, flag?: string) {
    if (!name && !flag) {
      throw new McpError(
        ErrorCode.InvalidParams,
        "Provide at least one of name or flag to update the tasklist"
      );
    }

    const payload: Record<string, unknown> = {};
    if (name) payload.name = name;
    if (flag) payload.flag = flag;

    const data = await this.makeRequest(
      `/portal/${this.config.portalId}/projects/${projectId}/tasklists/${tasklistId}`,
      "PATCH",
      payload
    );
    return {
      content: [
        {
          type: "text",
          text: `Tasklist updated successfully:\n${JSON.stringify(data, null, 2)}`,
        },
      ],
    };
  }

  private async listSubtasks(projectId: string, taskId: string, index: number = 0, range: number = 100) {
    // Use REST API for subtasks
    const restDomain = this.config.apiDomain?.replace('projectsapi', 'projectsapi') || 'https://projectsapi.zoho.com';
    const endpoint = `${restDomain}/restapi/portal/${this.config.portalId}/projects/${projectId}/tasks/${taskId}/subtasks/?index=${index}&range=${range}`;

    const response = await fetch(endpoint, {
      method: "GET",
      headers: {
        Authorization: `Zoho-oauthtoken ${this.config.accessToken}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to list subtasks: ${response.status} - ${error}`
      );
    }

    const data = await response.json() as Record<string, unknown>;
    const tasks = data.tasks as unknown[] | undefined;
    const hasMore = (tasks?.length ?? 0) >= range;

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ ...data, has_more: hasMore }, null, 2),
        },
      ],
    };
  }

  private async addTaskDependency(
    projectId: string,
    taskId: string,
    predecessorId: string,
    dependencyType: string = "FS",
    lagValue?: number,
    lagType?: string
  ) {
    // Use REST API for task dependencies
    const restDomain = this.config.apiDomain?.replace('projectsapi', 'projectsapi') || 'https://projectsapi.zoho.com';
    const endpoint = `${restDomain}/restapi/portal/${this.config.portalId}/projects/${projectId}/taskdependency/`;

    const body = new URLSearchParams();
    body.set("taskid", taskId);
    body.set("projId", projectId);
    body.set("toupdate", "dependencyset");
    body.set("predids", predecessorId);
    body.set("childprojId", projectId);

    if (dependencyType) {
      body.set("dependencytype", dependencyType);
    }
    if (lagValue !== undefined) {
      body.set("gapvalue", String(lagValue));
    }
    if (lagType) {
      body.set("gaptype", lagType);
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Zoho-oauthtoken ${this.config.accessToken}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to add task dependency: ${response.status} - ${error}`
      );
    }

    const data = await response.json();
    return {
      content: [
        {
          type: "text",
          text: `Task dependency added successfully:\n${JSON.stringify(data, null, 2)}`,
        },
      ],
    };
  }

  // Issue operations
  private async listIssues(
    projectId?: string,
    page: number = 1,
    perPage: number = 10
  ) {
    const endpoint = projectId
      ? `/portal/${this.config.portalId}/projects/${projectId}/issues?page=${page}&per_page=${perPage}`
      : `/portal/${this.config.portalId}/issues?page=${page}&per_page=${perPage}`;
    const data = await this.makeRequest(endpoint);
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }

  private async getIssue(projectId: string, issueId: string) {
    const data = await this.makeRequest(
      `/portal/${this.config.portalId}/projects/${projectId}/issues/${issueId}`
    );
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }

  private async createIssue(params: any) {
    const { project_id, ...issueData } = params;
    const data = await this.makeRequest(
      `/portal/${this.config.portalId}/projects/${project_id}/issues`,
      "POST",
      issueData
    );
    return {
      content: [
        {
          type: "text",
          text: `Issue created successfully:\n${JSON.stringify(data, null, 2)}`,
        },
      ],
    };
  }

  private async updateIssue(params: any) {
    const { project_id, issue_id, ...issueData } = params;
    const data = await this.makeRequest(
      `/portal/${this.config.portalId}/projects/${project_id}/issues/${issue_id}`,
      "PATCH",
      issueData
    );
    return {
      content: [
        {
          type: "text",
          text: `Issue updated successfully:\n${JSON.stringify(data, null, 2)}`,
        },
      ],
    };
  }

  // Phase operations
  private async listPhases(
    projectId: string,
    page: number = 1,
    perPage: number = 10
  ) {
    const data = await this.makeRequest(
      `/portal/${this.config.portalId}/projects/${projectId}/phases?page=${page}&per_page=${perPage}`
    );
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }

  private async createPhase(params: any) {
    const { project_id, ...phaseData } = params;
    const data = await this.makeRequest(
      `/portal/${this.config.portalId}/projects/${project_id}/phases`,
      "POST",
      phaseData
    );
    return {
      content: [
        {
          type: "text",
          text: `Phase created successfully:\n${JSON.stringify(data, null, 2)}`,
        },
      ],
    };
  }

  private async updatePhase(params: any, isRetry: boolean = false): Promise<any> {
    const { project_id, phase_id, ...phaseData } = params;

    // Use REST API (not v3) for milestone updates as v3 doesn't support it
    const restBaseUrl = (this.config.apiDomain || 'https://projectsapi.zoho.com').replace('/api/v3', '');

    // First fetch the existing milestone to get required fields
    const getEndpoint = `${restBaseUrl}/restapi/portal/${this.config.portalId}/projects/${project_id}/milestones/${phase_id}/`;
    const getResponse = await fetch(getEndpoint, {
      method: 'GET',
      headers: {
        'Authorization': `Zoho-oauthtoken ${this.config.accessToken}`,
      },
    });

    // Handle 401 with token refresh
    if (getResponse.status === 401 && !isRetry && this.config.refreshToken) {
      console.error("Received 401 error, attempting token refresh...");
      await this.refreshAccessToken();
      return this.updatePhase(params, true);
    }

    if (!getResponse.ok) {
      const errorText = await getResponse.text();
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to fetch milestone: ${getResponse.status} - ${errorText}`
      );
    }

    const existingData: any = await getResponse.json();
    const milestone = existingData.milestones?.[0] || existingData;

    // Helper to convert YYYY-MM-DD to MM-DD-YYYY
    const convertDate = (dateStr: string) => {
      if (!dateStr) return '';
      const parts = dateStr.split('-');
      if (parts.length === 3 && parts[0].length === 4) {
        // YYYY-MM-DD format, convert to MM-DD-YYYY
        return `${parts[1]}-${parts[2]}-${parts[0]}`;
      }
      return dateStr; // Already in correct format or other format
    };

    // Build form data with required fields from existing + updates
    const formData = new URLSearchParams();
    formData.append('name', phaseData.name || milestone.name);
    formData.append('flag', phaseData.flag || milestone.flag || 'internal');

    // REST API expects owner as string - try multiple possible field locations
    const ownerId = phaseData.owner_zuid || milestone.owner_id || milestone.owner?.zuid || milestone.owner?.id;
    if (ownerId) {
      formData.append('owner', String(ownerId));
    } else {
      console.error('Warning: No owner ID found in milestone data:', JSON.stringify(milestone.owner || {}, null, 2));
    }

    // Handle dates - convert from YYYY-MM-DD to MM-DD-YYYY
    if (phaseData.start_date) {
      formData.append('start_date', convertDate(phaseData.start_date));
    } else if (milestone.start_date) {
      formData.append('start_date', milestone.start_date);
    }

    if (phaseData.end_date) {
      formData.append('end_date', convertDate(phaseData.end_date));
    } else if (milestone.end_date) {
      formData.append('end_date', milestone.end_date);
    }

    if (phaseData.status) formData.append('status', phaseData.status);

    const updateEndpoint = `${restBaseUrl}/restapi/portal/${this.config.portalId}/projects/${project_id}/milestones/${phase_id}/`;
    const response = await fetch(updateEndpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Zoho-oauthtoken ${this.config.accessToken}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new McpError(
        ErrorCode.InternalError,
        `Milestone update error: ${response.status} - ${errorText}`
      );
    }

    const data = await response.json();
    return {
      content: [
        {
          type: "text",
          text: `Phase updated successfully:\n${JSON.stringify(data, null, 2)}`,
        },
      ],
    };
  }

  private async deletePhase(projectId: string, phaseId: string, isRetry: boolean = false): Promise<any> {
    // Use REST API for milestone deletion
    const restBaseUrl = (this.config.apiDomain || 'https://projectsapi.zoho.com').replace('/api/v3', '');
    const endpoint = `${restBaseUrl}/restapi/portal/${this.config.portalId}/projects/${projectId}/milestones/${phaseId}/`;

    const response = await fetch(endpoint, {
      method: 'DELETE',
      headers: {
        'Authorization': `Zoho-oauthtoken ${this.config.accessToken}`,
      },
    });

    // Handle 401 with token refresh
    if (response.status === 401 && !isRetry && this.config.refreshToken) {
      console.error("Received 401 error, attempting token refresh...");
      await this.refreshAccessToken();
      return this.deletePhase(projectId, phaseId, true);
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to delete milestone: ${response.status} - ${errorText}`
      );
    }

    // DELETE typically returns 200 or 204 on success
    let data: Record<string, any> = {};
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      try {
        data = await response.json() as Record<string, any>;
      } catch {
        // Empty response is fine for DELETE
      }
    }

    return {
      content: [
        {
          type: "text",
          text: `Phase/Milestone deleted successfully:\n${JSON.stringify(data, null, 2)}`,
        },
      ],
    };
  }

  // Search - uses REST API (not v3) for broader search capabilities
  private async search(params: any) {
    const { search_term, project_id, module = "all", page = 1, per_page = 10 } = params;

    // Calculate index from page and per_page (REST API uses index/range, not page/per_page)
    const index = (page - 1) * per_page;

    // Use REST API endpoint (not v3) for search as it supports more search features
    const restBaseUrl = (this.config.apiDomain || 'https://projectsapi.zoho.com').replace('/api/v3', '');

    const endpoint = project_id
      ? `${restBaseUrl}/restapi/portal/${this.config.portalId}/projects/${project_id}/search?search_term=${encodeURIComponent(search_term)}&module=${module}&index=${index}&range=${per_page}`
      : `${restBaseUrl}/restapi/portal/${this.config.portalId}/search?search_term=${encodeURIComponent(search_term)}&module=${module}&index=${index}&range=${per_page}`;

    // Make direct fetch since this uses different base URL
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        'Authorization': `Zoho-oauthtoken ${this.config.accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new McpError(
        ErrorCode.InternalError,
        `Search API error: ${response.status} - ${errorText}`
      );
    }

    const data = await response.json();
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }

  // Users
  private async listUsers(projectId?: string) {
    const endpoint = projectId
      ? `/portal/${this.config.portalId}/projects/${projectId}/users`
      : `/portal/${this.config.portalId}/users`;
    const data = await this.makeRequest(endpoint);
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }

  private async getMyTasks(index: number = 0, range: number = 100) {
    // Use REST API for my tasks
    const restDomain = this.config.apiDomain?.replace('projectsapi', 'projectsapi') || 'https://projectsapi.zoho.com';
    const endpoint = `${restDomain}/restapi/portal/${this.config.portalId}/mytasks/?index=${index}&range=${range}`;

    const response = await fetch(endpoint, {
      method: "GET",
      headers: {
        Authorization: `Zoho-oauthtoken ${this.config.accessToken}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to get my tasks: ${response.status} - ${error}`
      );
    }

    const data = await response.json() as Record<string, unknown>;
    const tasks = data.tasks as unknown[] | undefined;
    const hasMore = (tasks?.length ?? 0) >= range;

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ ...data, has_more: hasMore }, null, 2),
        },
      ],
    };
  }

  // Task Statuses
  private async listStatuses(projectId: string) {
    // Try the fields endpoint to get status field options
    try {
      const data = await this.makeRequest(
        `/portal/${this.config.portalId}/projects/${projectId}/fields?module=Tasks`
      );

      // Extract status field from the response
      if (data.fields) {
        const statusField = data.fields.find((f: any) => f.field_name === 'status' || f.display_name === 'Status');
        if (statusField && statusField.pick_list_values) {
          return {
            content: [{ type: "text", text: JSON.stringify({
              statuses: statusField.pick_list_values,
              field_info: statusField
            }, null, 2) }],
          };
        }
      }

      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    } catch (error) {
      // Fallback: return common status IDs based on project type
      return {
        content: [{ type: "text", text: JSON.stringify({
          error: "Could not fetch statuses from API. Common status IDs for reference:",
          common_statuses: [
            { name: "To Do", note: "Default open status - check task responses for actual ID" },
            { name: "Open", note: "In progress status - check task responses for actual ID" },
            { name: "In Review", note: "Review status - check task responses for actual ID" },
            { name: "Need More Information", note: "Blocked status - check task responses for actual ID" },
            { name: "Closed", note: "Completed status - check task responses for actual ID" }
          ],
          suggestion: "Get actual status IDs by examining the 'status' field in task responses from list_tasks or get_task"
        }, null, 2) }],
      };
    }
  }

  // Tags
  private async listTags(projectId: string) {
    const data = await this.makeRequest(
      `/portal/${this.config.portalId}/projects/${projectId}/tags`
    );
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }

  // Task Comments
  private async listTaskComments(
    projectId: string,
    taskId: string,
    page: number = 1,
    perPage: number = 10
  ) {
    const data = await this.makeRequest(
      `/portal/${this.config.portalId}/projects/${projectId}/tasks/${taskId}/comments?page=${page}&per_page=${perPage}`
    );
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }

  private async addTaskComment(
    projectId: string,
    taskId: string,
    content: string
  ) {
    // Validate content is not empty or whitespace-only
    if (!content || content.trim() === '') {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Comment content cannot be empty. Please provide meaningful content before posting.'
      );
    }

    // Validate minimum content length (helps prevent accidental submissions)
    if (content.trim().length < 10) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Comment content too short (${content.trim().length} chars). Minimum 10 characters required to prevent accidental submissions.`
      );
    }

    const data = await this.makeRequest(
      `/portal/${this.config.portalId}/projects/${projectId}/tasks/${taskId}/comments`,
      "POST",
      { comment: content }
    );

    // Construct task URL for easy access
    const taskUrl = `https://projects.zoho.com/portal/${this.config.portalName}/#taskdetail/${projectId}/${taskId}/${taskId}`;

    return {
      content: [
        {
          type: "text",
          text: `Comment added successfully.\n\nView task: ${taskUrl}\n\nResponse:\n${JSON.stringify(data, null, 2)}`,
        },
      ],
    };
  }

  private async editTaskComment(
    projectId: string,
    taskId: string,
    commentId: string,
    content: string
  ) {
    // Validate content is not empty or whitespace-only
    if (!content || content.trim() === '') {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Comment content cannot be empty. Please provide meaningful content before updating.'
      );
    }

    // Validate minimum content length (helps prevent accidental submissions)
    if (content.trim().length < 10) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Comment content too short (${content.trim().length} chars). Minimum 10 characters required to prevent accidental submissions.`
      );
    }

    const data = await this.makeRequest(
      `/portal/${this.config.portalId}/projects/${projectId}/tasks/${taskId}/comments/${commentId}`,
      "PATCH",
      { comment: content }
    );

    // Construct task URL for easy access
    const taskUrl = `https://projects.zoho.com/portal/${this.config.portalName}/#taskdetail/${projectId}/${taskId}/${taskId}`;

    return {
      content: [
        {
          type: "text",
          text: `Comment updated successfully.\n\nView task: ${taskUrl}\n\nResponse:\n${JSON.stringify(data, null, 2)}`,
        },
      ],
    };
  }

  private async deleteTaskComment(
    projectId: string,
    taskId: string,
    commentId: string
  ) {
    const data = await this.makeRequest(
      `/portal/${this.config.portalId}/projects/${projectId}/tasks/${taskId}/comments/${commentId}`,
      "DELETE"
    );

    const taskUrl = `https://projects.zoho.com/portal/${this.config.portalName}/#taskdetail/${projectId}/${taskId}/${taskId}`;

    return {
      content: [
        {
          type: "text",
          text: `Comment ${commentId} deleted successfully.\n\nView task: ${taskUrl}\n\nResponse:\n${JSON.stringify(data, null, 2)}`,
        },
      ],
    };
  }

  private async uploadTaskAttachment(
    projectId: string,
    taskId: string,
    filePath: string,
    fileName?: string
  ) {
    if (!fs.existsSync(filePath)) {
      throw new McpError(ErrorCode.InvalidRequest, `File not found: ${filePath}`);
    }

    // Refresh token if needed before upload
    if (Date.now() >= this.tokenExpiresAt) {
      await this.refreshAccessToken();
    }

    const actualFileName = fileName || path.basename(filePath);
    const fileBuffer = fs.readFileSync(filePath);

    // Use REST API endpoint (v1/v2) for attachments - not v3
    const restBaseUrl = (this.config.apiDomain || 'https://projectsapi.zoho.com').replace('/api/v3', '');
    const url = `${restBaseUrl}/restapi/portal/${this.config.portalId}/projects/${projectId}/tasks/${taskId}/attachments/`;

    // Create multipart form data
    const boundary = `----FormBoundary${Date.now()}`;
    const body = this.createMultipartBody(fileBuffer, actualFileName, boundary);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Zoho-oauthtoken ${this.config.accessToken}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body: body,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to upload attachment: ${response.status} - ${errorText}`
      );
    }

    const text = await response.text();
    const data = text ? JSON.parse(text) : { success: true };

    return {
      content: [
        {
          type: "text",
          text: `Attachment uploaded successfully:\n${JSON.stringify(data, null, 2)}`,
        },
      ],
    };
  }

  private createMultipartBody(fileBuffer: Buffer, fileName: string, boundary: string): Buffer {
    const CRLF = '\r\n';
    const mimeType = this.getMimeType(fileName);

    const header =
      `--${boundary}${CRLF}` +
      `Content-Disposition: form-data; name="uploaddoc"; filename="${fileName}"${CRLF}` +
      `Content-Type: ${mimeType}${CRLF}${CRLF}`;

    const footer = `${CRLF}--${boundary}--${CRLF}`;

    const headerBuffer = Buffer.from(header, 'utf-8');
    const footerBuffer = Buffer.from(footer, 'utf-8');

    return Buffer.concat([headerBuffer, fileBuffer, footerBuffer]);
  }

  private getMimeType(fileName: string): string {
    const ext = (fileName.toLowerCase().split('.').pop() || '');
    const mimeTypes: Record<string, string> = {
      'png': 'image/png',
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'gif': 'image/gif',
      'webm': 'video/webm',
      'mp4': 'video/mp4',
      'pdf': 'application/pdf',
    };
    return mimeTypes[ext] || 'application/octet-stream';
  }

  private getExtensionFromMimeType(mimeType: string): string {
    const mimeToExt: Record<string, string> = {
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/jpg': 'jpg',
      'image/gif': 'gif',
      'image/webp': 'webp',
      'image/svg+xml': 'svg',
    };
    return mimeToExt[mimeType] || 'png';
  }

  // List task attachments
  private async listTaskAttachments(projectId: string, taskId: string) {
    // Use REST API endpoint for attachments
    const restBaseUrl = (this.config.apiDomain || 'https://projectsapi.zoho.com').replace('/api/v3', '');

    // Refresh token if needed
    if (Date.now() >= this.tokenExpiresAt) {
      await this.refreshAccessToken();
    }

    const url = `${restBaseUrl}/restapi/portal/${this.config.portalId}/projects/${projectId}/tasks/${taskId}/attachments/`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Zoho-oauthtoken ${this.config.accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to list attachments: ${response.status} - ${errorText}`
      );
    }

    const data = await response.json();
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }

  // Delete task attachment
  private async deleteTaskAttachment(projectId: string, taskId: string, attachmentId: string) {
    // Refresh token if needed
    if (Date.now() >= this.tokenExpiresAt) {
      await this.refreshAccessToken();
    }

    // All attachments use the standard attachments endpoint
    // Note: Deleting attachments requires ZohoPC.files.ALL scope
    const restBaseUrl = (this.config.apiDomain || 'https://projectsapi.zoho.com').replace('/api/v3', '');
    const url = `${restBaseUrl}/restapi/portal/${this.config.portalId}/projects/${projectId}/tasks/${taskId}/attachments/${attachmentId}/`;

    const response = await fetch(url, {
      method: 'DELETE',
      headers: {
        'Authorization': `Zoho-oauthtoken ${this.config.accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to delete attachment: ${response.status} - ${errorText}. Note: Deleting attachments requires ZohoPC.files.ALL OAuth scope.`
      );
    }

    return {
      content: [{ type: "text", text: `Attachment ${attachmentId} deleted successfully.` }],
    };
  }

  // Extract inline image URLs from HTML
  private async extractInlineImages(html: string) {
    const imgRegex = /<img[^>]+src="([^"]+)"/gi;
    const urls: string[] = [];
    let match;

    while ((match = imgRegex.exec(html)) !== null) {
      const url = match[1];
      // Only get Zoho project attachment URLs
      if (url.includes('projects.zoho.com') || url.includes('projectsapi.zoho.com') || url.includes('viewInlineAttachment')) {
        urls.push(url);
      }
    }

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          count: urls.length,
          urls: urls
        }, null, 2)
      }],
    };
  }

  // Download a single inline image from Zoho
  private async downloadInlineImage(imageUrl: string, outputPath: string) {
    // Refresh token if needed
    if (Date.now() >= this.tokenExpiresAt) {
      await this.refreshAccessToken();
    }

    // Ensure output directory exists
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Parse the file parameter from the URL
    const urlObj = new URL(imageUrl);
    const fileParam = urlObj.searchParams.get('file');
    if (!fileParam) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        `Invalid Zoho image URL - no file parameter found: ${imageUrl}`
      );
    }

    // Try multiple API endpoints and domains
    const domains = ['projectsapi.zoho.com', 'projectsapi.zoho.eu', 'projects.zoho.com', 'projects.zoho.eu'];
    const endpoints = [
      // API endpoint for inline attachments
      (domain: string) => `https://${domain}/restapi/portal/${this.config.portalId}/inlineattachment/?file=${encodeURIComponent(fileParam)}`,
      // Direct viewInlineAttachment endpoint (ForApi variant)
      (domain: string) => `https://${domain.replace('projectsapi.', 'projects.')}/viewInlineAttachmentForApi/image?file=${encodeURIComponent(fileParam)}`,
      // Direct viewInlineAttachment endpoint (non-ForApi variant)
      (domain: string) => `https://${domain.replace('projectsapi.', 'projects.')}/viewInlineAttachment/image?file=${encodeURIComponent(fileParam)}`,
    ];

    let lastError: string = '';

    for (const domain of domains) {
      for (const endpointFn of endpoints) {
        const url = endpointFn(domain);
        try {
          const response = await fetch(url, {
            headers: {
              'Authorization': `Zoho-oauthtoken ${this.config.accessToken}`,
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            },
            redirect: 'follow',
          });

          if (response.ok) {
            const contentType = response.headers.get('content-type') || '';
            if (contentType.startsWith('image/')) {
              const arrayBuffer = await response.arrayBuffer();
              const buffer = Buffer.from(arrayBuffer);

              // Auto-detect extension if needed
              let finalPath = outputPath;
              if (!path.extname(outputPath)) {
                const ext = this.getExtensionFromMimeType(contentType);
                finalPath = `${outputPath}.${ext}`;
              }

              fs.writeFileSync(finalPath, buffer);

              return {
                content: [{
                  type: "text",
                  text: JSON.stringify({
                    success: true,
                    path: finalPath,
                    size: buffer.length,
                    contentType: contentType,
                    sourceUrl: url
                  }, null, 2)
                }],
              };
            } else {
              // Got a response but not an image - might be HTML login page
              lastError = `${url}: got ${contentType} instead of image`;
            }
          } else {
            lastError = `${url}: ${response.status} ${response.statusText}`;
          }
        } catch (e) {
          lastError = `${url}: ${e}`;
        }
      }
    }

    throw new McpError(
      ErrorCode.InternalError,
      `Failed to download image. Tried multiple endpoints. Last error: ${lastError}`
    );
  }

  // Download all images from a task description
  private async downloadTaskImages(projectId: string, taskId: string, outputDir: string) {
    // Get the task first to get its description
    const taskData = await this.makeRequest(
      `/portal/${this.config.portalId}/projects/${projectId}/tasks/${taskId}`
    );

    const description = taskData.tasks?.[0]?.description || taskData.description || '';
    if (!description) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: true,
            message: "No description found in task",
            images: []
          }, null, 2)
        }],
      };
    }

    // Extract image URLs
    const imgRegex = /<img[^>]+src="([^"]+)"/gi;
    const urls: string[] = [];
    let match;

    while ((match = imgRegex.exec(description)) !== null) {
      const url = match[1];
      if (url.includes('projects.zoho.com') || url.includes('projectsapi.zoho.com') || url.includes('viewInlineAttachment')) {
        urls.push(url);
      }
    }

    if (urls.length === 0) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: true,
            message: "No inline images found in task description",
            images: []
          }, null, 2)
        }],
      };
    }

    // Ensure output directory exists
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Download each image
    const results: Array<{ url: string; localPath: string | null; error?: string }> = [];

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      const baseName = `image_${i + 1}`;
      const outputPath = path.join(outputDir, baseName);

      try {
        const result = await this.downloadInlineImage(url, outputPath);
        const resultData = JSON.parse((result.content[0] as { type: string; text: string }).text);
        results.push({
          url: url,
          localPath: resultData.path
        });
      } catch (e) {
        results.push({
          url: url,
          localPath: null,
          error: e instanceof Error ? e.message : String(e)
        });
      }
    }

    const successCount = results.filter(r => r.localPath).length;

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          success: true,
          totalImages: urls.length,
          downloadedImages: successCount,
          failedImages: urls.length - successCount,
          images: results
        }, null, 2)
      }],
    };
  }

  // Export an entire project to a local directory
  private async exportProject(projectId: string, outputDir: string, includeImages: boolean = true) {
    // Ensure output directory exists
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const imagesDir = path.join(outputDir, 'images');
    if (includeImages && !fs.existsSync(imagesDir)) {
      fs.mkdirSync(imagesDir, { recursive: true });
    }

    console.error(`Exporting project ${projectId} to ${outputDir}`);

    // 1. Fetch project details
    console.error('Fetching project details...');
    const projectData = await this.makeRequest(
      `/portal/${this.config.portalId}/projects/${projectId}`
    );
    const project = projectData.projects?.[0] || projectData;

    // 2. Fetch all milestones/phases with pagination
    console.error('Fetching milestones...');
    const milestones: any[] = [];
    let milestonePage = 1;
    const milestonePerPage = 100;
    while (true) {
      const phasesData = await this.makeRequest(
        `/portal/${this.config.portalId}/projects/${projectId}/phases?page=${milestonePage}&per_page=${milestonePerPage}`
      );
      const phases = phasesData.phases || [];
      milestones.push(...phases);

      const pageInfo = phasesData.page_info;
      if (!pageInfo?.has_next_page || phases.length === 0) {
        break;
      }
      milestonePage++;
    }
    console.error(`Fetched ${milestones.length} milestones`);

    // 3. Fetch all tasks with pagination
    console.error('Fetching tasks...');
    const tasks: any[] = [];
    let taskPage = 1;
    const taskPerPage = 100;
    while (true) {
      const tasksData = await this.makeRequest(
        `/portal/${this.config.portalId}/projects/${projectId}/tasks?page=${taskPage}&per_page=${taskPerPage}`
      );
      const tasksList = tasksData.tasks || [];
      tasks.push(...tasksList);

      const pageInfo = tasksData.page_info;
      if (!pageInfo?.has_next_page || tasksList.length === 0) {
        break;
      }
      taskPage++;
      console.error(`Fetched ${tasks.length} tasks so far (page ${taskPage - 1})...`);
    }
    console.error(`Fetched ${tasks.length} total tasks`);

    // 4. Optionally download inline images from task descriptions
    const imageMapping: Record<string, string> = {};
    let totalImages = 0;
    let downloadedImages = 0;

    if (includeImages) {
      console.error('Downloading inline images from task descriptions...');

      for (const task of tasks) {
        const description = task.description || '';
        if (!description) continue;

        // Extract image URLs from this task
        const imgRegex = /<img[^>]+src="([^"]+)"/gi;
        let match;
        const taskImages: string[] = [];

        while ((match = imgRegex.exec(description)) !== null) {
          const url = match[1];
          if (url.includes('projects.zoho.com') || url.includes('projectsapi.zoho.com') || url.includes('viewInlineAttachment')) {
            taskImages.push(url);
          }
        }

        if (taskImages.length === 0) continue;

        totalImages += taskImages.length;

        for (let i = 0; i < taskImages.length; i++) {
          const url = taskImages[i];

          // Skip if we already downloaded this URL
          if (imageMapping[url]) continue;

          // Generate unique filename based on task ID and index
          const baseName = `task_${task.id}_img_${i + 1}`;
          const outputPath = path.join(imagesDir, baseName);

          try {
            // Download the image using the existing method (but without returning MCP response)
            // Inline the download logic here to get raw results
            const urlObj = new URL(url);
            const fileParam = urlObj.searchParams.get('file');
            if (!fileParam) {
              console.error(`Skipping invalid image URL (no file param): ${url}`);
              continue;
            }

            let downloaded = false;
            const domains = ['projectsapi.zoho.com', 'projectsapi.zoho.eu', 'projects.zoho.com', 'projects.zoho.eu'];
            const endpoints = [
              (domain: string) => `https://${domain}/restapi/portal/${this.config.portalId}/inlineattachment/?file=${encodeURIComponent(fileParam)}`,
              (domain: string) => `https://${domain.replace('projectsapi.', 'projects.')}/viewInlineAttachmentForApi/image?file=${encodeURIComponent(fileParam)}`,
              (domain: string) => `https://${domain.replace('projectsapi.', 'projects.')}/viewInlineAttachment/image?file=${encodeURIComponent(fileParam)}`,
            ];

            for (const domain of domains) {
              if (downloaded) break;
              for (const endpointFn of endpoints) {
                if (downloaded) break;
                const downloadUrl = endpointFn(domain);
                try {
                  const response = await fetch(downloadUrl, {
                    headers: {
                      'Authorization': `Zoho-oauthtoken ${this.config.accessToken}`,
                      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    },
                    redirect: 'follow',
                  });

                  if (response.ok) {
                    const contentType = response.headers.get('content-type') || '';
                    if (contentType.startsWith('image/')) {
                      const arrayBuffer = await response.arrayBuffer();
                      const buffer = Buffer.from(arrayBuffer);

                      const ext = this.getExtensionFromMimeType(contentType);
                      const finalPath = `${outputPath}.${ext}`;
                      const relativePath = `images/${baseName}.${ext}`;

                      fs.writeFileSync(finalPath, buffer);
                      imageMapping[url] = relativePath;
                      downloadedImages++;
                      downloaded = true;
                    }
                  }
                } catch (e) {
                  // Continue to next endpoint
                }
              }
            }

            if (!downloaded) {
              console.error(`Failed to download image: ${url}`);
            }
          } catch (e) {
            console.error(`Error downloading image from task ${task.id}: ${e}`);
          }
        }
      }
      console.error(`Downloaded ${downloadedImages}/${totalImages} images`);
    }

    // 5. Build export object
    const exportData = {
      exportVersion: 1,
      exportedAt: new Date().toISOString(),
      portalId: this.config.portalId,
      project: {
        id: project.id,
        name: project.name,
        description: project.description,
        status: project.status,
        start_date: project.start_date,
        end_date: project.end_date,
        created_time: project.created_time,
        owner: project.owner,
      },
      milestones: milestones.map((m: any) => ({
        id: m.id,
        name: m.name,
        start_date: m.start_date,
        end_date: m.end_date,
        status: m.status,
        sequence: m.sequence,
      })),
      tasks: tasks.map((t: any) => ({
        id: t.id,
        prefix: t.prefix || t.key,
        name: t.name,
        description: t.description,
        status: t.status,
        priority: t.priority,
        start_date: t.start_date,
        end_date: t.end_date,
        created_time: t.created_time,
        completed_time: t.completed_time,
        milestone: t.milestone,
        tasklist: t.tasklist,
        percent_complete: t.percent_complete,
        duration: t.duration,
      })),
      imageMapping: imageMapping,
      stats: {
        totalMilestones: milestones.length,
        totalTasks: tasks.length,
        totalImages: totalImages,
        downloadedImages: downloadedImages,
      }
    };

    // 6. Write project.json
    const projectJsonPath = path.join(outputDir, 'project.json');
    fs.writeFileSync(projectJsonPath, JSON.stringify(exportData, null, 2));
    console.error(`Export complete: ${projectJsonPath}`);

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          success: true,
          outputDir: outputDir,
          projectJsonPath: projectJsonPath,
          imagesDir: includeImages ? imagesDir : null,
          stats: exportData.stats,
          message: `Exported project "${project.name}" with ${milestones.length} milestones, ${tasks.length} tasks, and ${downloadedImages}/${totalImages} images`
        }, null, 2)
      }],
    };
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("Zoho Projects MCP server running on stdio");
  }
}

const server = new ZohoProjectsServer();
server.run().catch(console.error);