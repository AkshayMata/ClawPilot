/**
 * Auto-provision a dev tunnel for the ClawPilot server.
 *
 * Strategy:
 *   1. If PUBLIC_URL is already set in env → use it (skip tunnel)
 *   2. Try `devtunnel host -p <port> --allow-anonymous` → parse the URL
 *   3. If devtunnel isn't installed → try `winget install Microsoft.devtunnel`
 *   4. If everything fails → throw with a clear setup message
 *
 * The tunnel process is spawned as a child and killed on process exit.
 */
import { spawn, execSync, type ChildProcess } from "child_process";

export interface TunnelResult {
  /** The public URL (e.g. https://abc123-3978.usw2.devtunnels.ms) */
  url: string;
  /** Whether we started a new devtunnel process (vs. using existing PUBLIC_URL) */
  managed: boolean;
}

let tunnelProcess: ChildProcess | null = null;

/**
 * Ensure a public URL is available for the given port.
 * Resolves with the public URL, or rejects with setup instructions.
 */
export async function ensurePublicUrl(port: number): Promise<TunnelResult> {
  // 1. If PUBLIC_URL is set, verify it's reachable
  const envUrl = process.env.PUBLIC_URL;
  if (envUrl && envUrl.startsWith("http")) {
    if (await isUrlReachable(envUrl)) {
      console.log(`[Tunnel] PUBLIC_URL is reachable: ${envUrl}`);
      return { url: envUrl, managed: false };
    }
    console.warn(`[Tunnel] PUBLIC_URL set but not reachable: ${envUrl}`);
    console.warn(`[Tunnel] Will attempt to start a new devtunnel instead.`);
  }

  // 2. Try to start a devtunnel
  if (isDevtunnelAvailable()) {
    return startDevtunnel(port);
  }

  // 3. Try to install devtunnel
  console.log("[Tunnel] devtunnel not found. Attempting install via winget...");
  if (tryInstallDevtunnel()) {
    return startDevtunnel(port);
  }

  // 4. Nothing worked — fail with instructions
  throw new Error(
    `[Tunnel] Cannot establish a public URL for port ${port}.\n\n` +
    `ClawPilot needs a public URL so Teams can reach the outgoing webhook.\n\n` +
    `Options:\n` +
    `  1. Install devtunnel:  winget install Microsoft.devtunnel\n` +
    `     Then login:         devtunnel user login\n` +
    `  2. Set PUBLIC_URL in .env to an existing tunnel/proxy URL\n` +
    `  3. Forward port ${port} in VS Code (Ctrl+Shift+P → "Forward a Port")\n` +
    `     Then set PUBLIC_URL in .env to the forwarded URL`
  );
}

/**
 * Check if a URL is reachable by probing it.
 * Since our server isn't listening yet during startup, we just check
 * that the tunnel/proxy responds at all (any status code = reachable).
 */
async function isUrlReachable(url: string): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    await fetch(url, { method: "HEAD", signal: controller.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function isDevtunnelAvailable(): boolean {
  try {
    execSync("devtunnel --version", { stdio: "pipe", timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

function isDevtunnelLoggedIn(): boolean {
  try {
    const output = execSync("devtunnel user show", {
      encoding: "utf-8",
      stdio: "pipe",
      timeout: 5_000,
    });
    return !output.includes("Not logged in");
  } catch {
    return false;
  }
}

function tryInstallDevtunnel(): boolean {
  try {
    console.log("[Tunnel] Installing devtunnel via winget...");
    execSync(
      "winget install Microsoft.devtunnel --accept-source-agreements --accept-package-agreements",
      { stdio: "pipe", timeout: 120_000 }
    );
    return isDevtunnelAvailable();
  } catch {
    console.warn("[Tunnel] winget install failed — winget may not be available.");
    return false;
  }
}

function startDevtunnel(port: number): Promise<TunnelResult> {
  if (!isDevtunnelLoggedIn()) {
    throw new Error(
      `[Tunnel] devtunnel is installed but not logged in.\n\n` +
      `Run this once:  devtunnel user login\n` +
      `Then restart the server.`
    );
  }

  return new Promise<TunnelResult>((resolve, reject) => {
    console.log(`[Tunnel] Starting devtunnel on port ${port}...`);

    const child = spawn("devtunnel", ["host", "-p", String(port), "--allow-anonymous"], {
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
    });

    tunnelProcess = child;

    let resolved = false;
    let output = "";

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        reject(
          new Error(
            `[Tunnel] devtunnel did not produce a URL within 30 seconds.\n` +
            `Output so far: ${output.slice(0, 500)}`
          )
        );
      }
    }, 30_000);

    child.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      output += text;
      process.stdout.write(`[Tunnel] ${text}`);

      // devtunnel outputs lines like:
      //   Connect via browser: https://abc123-3978.usw2.devtunnels.ms
      const urlMatch = output.match(/https:\/\/[^\s]+\.devtunnels\.ms[^\s]*/);
      if (urlMatch && !resolved) {
        resolved = true;
        clearTimeout(timeout);
        const url = urlMatch[0].replace(/\/$/, ""); // strip trailing slash
        console.log(`[Tunnel] Public URL: ${url}`);
        resolve({ url, managed: true });
      }
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      output += text;
      process.stderr.write(`[Tunnel:err] ${text}`);
    });

    child.on("error", (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        reject(new Error(`[Tunnel] Failed to start devtunnel: ${err.message}`));
      }
    });

    child.on("exit", (code) => {
      tunnelProcess = null;
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        reject(
          new Error(
            `[Tunnel] devtunnel exited with code ${code} before producing a URL.\n` +
            `Output: ${output.slice(0, 500)}`
          )
        );
      }
    });

    // Clean up tunnel on process exit
    const cleanup = () => {
      if (child && !child.killed) {
        console.log("[Tunnel] Shutting down devtunnel...");
        child.kill();
      }
    };
    process.on("exit", cleanup);
    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);
  });
}

/** Kill the managed tunnel process if running */
export function stopTunnel(): void {
  if (tunnelProcess && !tunnelProcess.killed) {
    tunnelProcess.kill();
    tunnelProcess = null;
  }
}
