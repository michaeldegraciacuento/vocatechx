import { Channel, invoke, isTauri } from "@tauri-apps/api/core";

export type SessionUser = {
  id: number;
  username: string;
  role: "admin" | "technician";
  mustChangePassword: boolean;
};

export type AppErrorCode =
  | "invalid_credentials"
  | "locked_out"
  | "unauthenticated"
  | "password_change_required"
  | "validation"
  | "ai"
  | "database"
  | "internal";

export type AppError = {
  code: AppErrorCode;
  message: string;
  retryAfterSeconds: number | null;
};

export type SystemOverview = {
  hostName: string | null;
  os: {
    name: string | null;
    version: string | null;
    longVersion: string | null;
    kernelVersion: string | null;
  };
  cpu: {
    brand: string | null;
    physicalCores: number | null;
    logicalCores: number;
    usagePercent: number | null;
  };
  memory: { totalBytes: number; usedBytes: number; availableBytes: number } | null;
  storage: {
    name: string;
    mountPoint: string;
    fileSystem: string;
    totalBytes: number;
    availableBytes: number;
    removable: boolean;
  }[];
  uptimeSeconds: number;
};

export type ActivityItem = {
  id: number;
  operationType: string;
  title: string;
  status: "running" | "success" | "failed" | "cancelled";
  summary: string | null;
  startedAt: number;
  finishedAt: number | null;
};

export type RalpState = "runtime_missing" | "model_missing" | "stopped" | "starting" | "ready" | "error";

export type RalpStatus = {
  state: RalpState;
  message: string | null;
  modelName: string | null;
  /** Folder beside the installed app where the model file can be placed. */
  modelFolder: string;
};

export type ConversationSummary = { id: number; title: string; updatedAt: number };

export type ChatMessage = {
  id: number;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
};

export type ChatEvent =
  | { type: "started"; conversationId: number; userMessage: ChatMessage }
  | { type: "delta"; text: string }
  | { type: "done"; message: ChatMessage | null; cancelled: boolean };

export type ImportProgress = { copiedBytes: number; totalBytes: number };

export type SystemStatus = {
  databaseReady: boolean;
  schemaVersion: number;
  ralp: RalpStatus;
  networkRequired: boolean;
};

export function isAppError(error: unknown): error is AppError {
  return typeof error === "object" && error !== null && "code" in error && "message" in error;
}

export function errorMessage(error: unknown): string {
  if (isAppError(error)) return error.message;
  if (!isTauri()) return "The VocaTechX backend is not available. Start the app with `npm run tauri dev`.";
  return "An unexpected error occurred. Please try again.";
}

export const api = {
  getSession: () => invoke<SessionUser | null>("get_session"),
  login: (username: string, password: string) => invoke<SessionUser>("login", { username, password }),
  logout: () => invoke<void>("logout"),
  changePassword: (currentPassword: string, newPassword: string, confirmPassword: string) =>
    invoke<SessionUser>("change_password", { currentPassword, newPassword, confirmPassword }),
  getSystemOverview: () => invoke<SystemOverview>("get_system_overview"),
  getRecentActivity: (limit?: number) => invoke<ActivityItem[]>("get_recent_activity", { limit }),
  getSystemStatus: () => invoke<SystemStatus>("get_system_status"),

  ralpStatus: () => invoke<RalpStatus>("ralp_status"),
  ralpStart: () => invoke<RalpStatus>("ralp_start"),
  ralpImportModel: (onProgress: (progress: ImportProgress) => void) => {
    const channel = new Channel<ImportProgress>();
    channel.onmessage = onProgress;
    return invoke<string | null>("ralp_import_model", { onProgress: channel });
  },
  ralpListConversations: () => invoke<ConversationSummary[]>("ralp_list_conversations"),
  ralpGetMessages: (conversationId: number) => invoke<ChatMessage[]>("ralp_get_messages", { conversationId }),
  ralpDeleteConversation: (conversationId: number) => invoke<void>("ralp_delete_conversation", { conversationId }),
  ralpSendMessage: (conversationId: number | null, message: string, onEvent: (event: ChatEvent) => void) => {
    const channel = new Channel<ChatEvent>();
    channel.onmessage = onEvent;
    return invoke<void>("ralp_send_message", { conversationId, message, onEvent: channel });
  },
  ralpStopGeneration: () => invoke<void>("ralp_stop_generation"),
};
