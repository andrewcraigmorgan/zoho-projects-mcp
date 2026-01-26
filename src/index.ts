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
              description: { type: "string", description: "Task description" },
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
              description: { type: "string", description: "Task description" },
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
            },
            required: ["project_id", "task_id"],
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
              owner_zpuid: { type: "string", description: "Owner user ZPUID" },
            },
            required: ["project_id", "name"],
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
          case "create_tasklist":
            return await this.createTasklist(params);
          case "move_task":
            return await this.moveTask(params.project_id, params.task_id, params.tasklist_id);
          case "delete_tasklist":
            return await this.deleteTasklist(params.project_id, params.tasklist_id);

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

          // Search
          case "search":
            return await this.search(params);

          // Users
          case "list_users":
            return await this.listUsers(params.project_id);

          // Task Statuses
          case "list_statuses":
            return await this.listStatuses(params.project_id);

          // Task Comments
          case "list_task_comments":
            return await this.listTaskComments(params.project_id, params.task_id, params.page, params.per_page);
          case "add_task_comment":
            return await this.addTaskComment(params.project_id, params.task_id, params.content);
          case "edit_task_comment":
            return await this.editTaskComment(params.project_id, params.task_id, params.comment_id, params.content);
          case "upload_task_attachment":
            return await this.uploadTaskAttachment(params.project_id, params.task_id, params.file_path, params.file_name);
          case "list_task_attachments":
            return await this.listTaskAttachments(params.project_id, params.task_id);
          case "download_inline_image":
            return await this.downloadInlineImage(params.image_url, params.output_path);
          case "extract_inline_images":
            return await this.extractInlineImages(params.html);
          case "download_task_images":
            return await this.downloadTaskImages(params.project_id, params.task_id, params.output_dir);

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
              const taskId = result.id || result.id_string;
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
            const taskProjectId = result.project_id || result.project?.id;
            const taskId = result.id || result.id_string;
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
    const { project_id, tasklist_id, ...taskData } = params;
    // Map tasklist_id to tasklist for the API
    if (tasklist_id) {
      taskData.tasklist = { id: tasklist_id };
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
    const { project_id, task_id, status_id, tasklist_id, ...taskData } = params;
    // Map status_id to status for the API
    if (status_id) {
      taskData.status = { id: status_id };
    }
    // Map tasklist_id to tasklist for the API
    if (tasklist_id) {
      taskData.tasklist = { id: tasklist_id };
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

  // Task Statuses
  private async listStatuses(projectId: string) {
    const data = await this.makeRequest(
      `/portal/${this.config.portalId}/projects/${projectId}/tasklayouts`
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
    const data = await this.makeRequest(
      `/portal/${this.config.portalId}/projects/${projectId}/tasks/${taskId}/comments`,
      "POST",
      { comment: content }
    );
    return {
      content: [
        {
          type: "text",
          text: `Comment added successfully:\n${JSON.stringify(data, null, 2)}`,
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
    const data = await this.makeRequest(
      `/portal/${this.config.portalId}/projects/${projectId}/tasks/${taskId}/comments/${commentId}`,
      "PATCH",
      { comment: content }
    );
    return {
      content: [
        {
          type: "text",
          text: `Comment updated successfully:\n${JSON.stringify(data, null, 2)}`,
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

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("Zoho Projects MCP server running on stdio");
  }
}

const server = new ZohoProjectsServer();
server.run().catch(console.error);