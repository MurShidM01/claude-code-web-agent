import { BridgeError } from "@/lib/protocol/errors";
import type { WorkspaceInfo, WorkspacePort } from "@/lib/workspace/types";

const MESSAGE =
  "No workspace is connected. The browser cannot control the operating system by itself. Connect the local execution bridge, or pick a folder with the File System Access API for file tools. Shell and git still need the bridge.";

export class UnavailableWorkspace implements WorkspacePort {
  info(): WorkspaceInfo | null {
    return null;
  }

  private fail(): never {
    throw new BridgeError("workspace_required", MESSAGE);
  }

  readFile(): Promise<never> {
    return this.fail();
  }
  writeFile(): Promise<never> {
    return this.fail();
  }
  deleteFile(): Promise<never> {
    return this.fail();
  }
  renamePath(): Promise<never> {
    return this.fail();
  }
  listDirectory(): Promise<never> {
    return this.fail();
  }
  searchFiles(): Promise<never> {
    return this.fail();
  }
  getFileMetadata(): Promise<never> {
    return this.fail();
  }
  mkdir(): Promise<never> {
    return this.fail();
  }
  runCommand(): Promise<never> {
    return this.fail();
  }
  getProcessStatus(): Promise<never> {
    return this.fail();
  }
  killProcess(): Promise<never> {
    return this.fail();
  }
  gitStatus(): Promise<never> {
    return this.fail();
  }
  gitDiff(): Promise<never> {
    return this.fail();
  }
  gitLog(): Promise<never> {
    return this.fail();
  }
}
