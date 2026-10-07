import { BridgeError, type BridgeErrorCode, isBridgeError } from "@/lib/protocol/errors";

/**
 * Workspace backends fail in three dialects:
 * - the bridge and the in-memory workspace throw BridgeError (typed `code`)
 * - Node file APIs throw system errors (`code: "ENOENT"` etc.)
 * - the browser File System Access API throws DOMExceptions (`name: "NotFoundError"`)
 *
 * Tool code must recognize all three. These helpers normalize them so a
 * missing file is always `not_found`, never a raw browser or OS error string.
 */

const NOT_FOUND_MESSAGE = /not_found|enoent|no such file|could not be found|does not exist|doesn't exist|not found/i;

export function errorCodeOf(error: unknown): string | undefined {
  if (isBridgeError(error)) return String((error as { code: unknown }).code);
  if (error && typeof error === "object") {
    const named = (error as { code?: unknown }).code;
    if (typeof named === "string") return named;
    if (typeof named === "number") return String(named);
    const name = (error as { name?: unknown }).name;
    if (typeof name === "string" && name && name !== "Error") return name;
  }
  return undefined;
}

export function isNotFoundError(error: unknown): boolean {
  if (isBridgeError(error) && (error as { code: unknown }).code === "not_found") return true;
  if (error && typeof error === "object") {
    // Node system errors (ENOENT) and browser DOMExceptions (NotFoundError).
    // DOMException is not instanceof Error in browsers, so check by shape.
    const code = (error as { code?: unknown }).code;
    if (code === "ENOENT") return true;
    const name = (error as { name?: unknown }).name;
    if (name === "NotFoundError") return true;
  }
  const message = error instanceof Error ? error.message : String(error ?? "");
  return NOT_FOUND_MESSAGE.test(message);
}

export function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = (error as { name?: unknown }).name;
  const code = (error as { code?: unknown }).code;
  return name === "AbortError" || code === "ABORT_ERR";
}

/**
 * Translate a File System Access API DOMException into a typed BridgeError so
 * the agent loop, the permission layer, and the UI all see stable codes
 * instead of browser internals like "A requested file or directory could not
 * be found at the time an operation was processed."
 */
export function fsaErrorToBridgeError(error: unknown, context: string): BridgeError {
  if (isBridgeError(error)) return error as BridgeError;
  if (error && typeof error === "object") {
    // DOMException is not `instanceof Error` in browsers, so detect by shape.
    const name = (error as { name?: unknown }).name;
    const message = (error as { message?: unknown }).message;
    switch (typeof name === "string" ? name : "") {
      case "NotFoundError":
        return new BridgeError("not_found", `No such file or directory: ${context}`);
      case "TypeMismatchError":
        return new BridgeError("not_a_file", `${context} is a directory. Remove or move it before writing a file there.`);
      case "NotAllowedError":
      case "SecurityError":
        return new BridgeError(
          "forbidden",
          `The browser did not grant write access to ${context}. Re-open the folder and allow read/write access.`,
        );
      case "NoModificationAllowedError":
        return new BridgeError("forbidden", `${context} is locked by another process. Close it and try again.`);
      case "AbortError":
        return new BridgeError("cancelled", `The operation on ${context} was aborted.`);
      case "InvalidModificationError":
        return new BridgeError("invalid_params", `${context} cannot be modified in its current state.`);
      default:
        return new BridgeError(
          "internal",
          typeof message === "string" && message ? message : `The file operation on ${context} failed.`,
        );
    }
  }
  return new BridgeError("internal", `The file operation on ${context} failed.`);
}

export function bridgeErrorCodeOf(error: unknown): BridgeErrorCode | undefined {
  const code = errorCodeOf(error);
  return code as BridgeErrorCode | undefined;
}
