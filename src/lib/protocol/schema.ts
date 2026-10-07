import { z } from "zod";

export const bridgeMethods = [
  "readFile",
  "readBinary",
  "writeFile",
  "deleteFile",
  "renamePath",
  "listDirectory",
  "searchFiles",
  "getFileMetadata",
  "runCommand",
  "getProcessStatus",
  "killProcess",
  "gitStatus",
  "gitDiff",
  "gitLog",
  "mkdir",
] as const;

export type BridgeMethod = (typeof bridgeMethods)[number];

export const readFileParams = z.object({
  path: z.string().min(1),
  offset: z.number().int().positive().optional(),
  limit: z.number().int().positive().max(5000).optional(),
});

export const readBinaryParams = z.object({
  path: z.string().min(1),
  maxBytes: z.number().int().positive().max(8_000_000).optional(),
});

export const writeFileParams = z.object({
  path: z.string().min(1),
  content: z.string(),
  mkdirp: z.boolean().optional(),
});

export const deleteFileParams = z.object({
  path: z.string().min(1),
  recursive: z.boolean().optional(),
});

export const renamePathParams = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  overwrite: z.boolean().optional(),
});

export const listDirectoryParams = z.object({
  path: z.string().optional(),
  depth: z.number().int().min(1).max(6).optional(),
});

export const searchFilesParams = z.object({
  pattern: z.string().optional(),
  query: z.string().optional(),
  path: z.string().optional(),
  glob: z.string().optional(),
  maxResults: z.number().int().positive().max(500).optional(),
});

export const metadataParams = z.object({
  path: z.string().min(1),
});

export const runCommandParams = z.object({
  command: z.string().min(1).max(20_000),
  cwd: z.string().optional(),
  timeoutMs: z.number().int().positive().max(600_000).optional(),
  background: z.boolean().optional(),
  acknowledgedRisk: z.boolean().optional(),
});

export const processParams = z.object({
  processId: z.string().min(1),
});

export const gitDiffParams = z.object({
  ref: z.string().max(200).optional(),
  staged: z.boolean().optional(),
  path: z.string().optional(),
});

export const gitLogParams = z.object({
  limit: z.number().int().positive().max(100).optional(),
});

export const mkdirParams = z.object({
  path: z.string().min(1),
});

export const rpcRequest = z.object({
  id: z.string().min(1),
  method: z.enum(bridgeMethods),
  params: z.unknown().optional(),
});

export type RpcRequest = z.infer<typeof rpcRequest>;

export const paramSchema: Record<BridgeMethod, z.ZodTypeAny> = {
  readFile: readFileParams,
  readBinary: readBinaryParams,
  writeFile: writeFileParams,
  deleteFile: deleteFileParams,
  renamePath: renamePathParams,
  listDirectory: listDirectoryParams,
  searchFiles: searchFilesParams,
  getFileMetadata: metadataParams,
  runCommand: runCommandParams,
  getProcessStatus: processParams,
  killProcess: processParams,
  gitStatus: z.object({}).optional().default({}),
  gitDiff: gitDiffParams,
  gitLog: gitLogParams,
  mkdir: mkdirParams,
};
