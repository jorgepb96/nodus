import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
export class SignEngine {
  private child: ChildProcessWithoutNullStreams | null = null;
  constructor(
    readonly python: string,
    readonly script: string,
  ) {}
  cancel() {
    this.child?.kill();
  }
  async run<T>(request: object): Promise<T> {
    if (this.child) throw new Error("SIGN_ENGINE_BUSY");
    return new Promise<T>((resolve, reject) => {
      const child = spawn(this.python, ["-I", this.script], {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
      this.child = child;
      let output = "";
      let settled = false;
      const finish = (error?: Error, value?: T) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.child = null;
        if (error) reject(error);
        else resolve(value!);
      };
      const timer = setTimeout(() => {
        child.kill();
        finish(new Error("SIGN_ENGINE_TIMEOUT"));
      }, 90_000);
      child.on("error", () => finish(new Error("SIGN_ENGINE_UNAVAILABLE")));
      child.stdin.on("error", () => {});
      child.stderr.resume();
      child.stdout.on("data", (chunk: Buffer) => {
        output += chunk.toString("utf8");
        if (output.length > 220 * 1024 * 1024) {
          child.kill();
          finish(new Error("SIGN_ENGINE_OUTPUT_LIMIT"));
        }
      });
      child.on("close", (_code, signal) => {
        if (signal) return finish(new Error("SIGN_CANCELLED"));
        try {
          const result = JSON.parse(output);
          if (result.ok) finish(undefined, result.result);
          else finish(new Error(result.error || "SIGN_ENGINE_ERROR"));
        } catch {
          finish(new Error("SIGN_ENGINE_UNAVAILABLE"));
        }
      });
      child.stdin.end(JSON.stringify(request));
    });
  }
}
