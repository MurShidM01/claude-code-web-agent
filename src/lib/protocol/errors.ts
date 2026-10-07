export const PROTOCOL_VERSION = 1;

export type BridgeErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "workspace_required"
  | "path_escape"
  | "not_found"
  | "already_exists"
  | "invalid_params"
  | "timeout"
  | "cancelled"
  | "output_limit"
  | "dangerous_blocked"
  | "not_a_file"
  | "not_a_directory"
  | "binary_file"
  | "internal"
  | "method_not_found"
  | "process_not_found"
  | "bridge_unavailable"
  | "capability_unavailable";

export class BridgeError extends Error {
  constructor(
    readonly code: BridgeErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "BridgeError";
  }

  toJSON() {
    return { code: this.code, message: this.message, details: this.details };
  }
}

export function isBridgeError(value: unknown): value is BridgeError {
  return value instanceof BridgeError || (typeof value === "object" && value !== null && "code" in value && "message" in value);
}
