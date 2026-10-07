import { readBridgeTokenFile } from "@/lib/bridge/token-file";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UNAVAILABLE = {
  ok: false,
  error: {
    code: "bridge_unavailable",
    message:
      "The local execution bridge is not running on this machine. Start it with npm run bridge. A remote deployment cannot control your computer until you connect a bridge yourself.",
  },
};

async function proxy(request: Request, path: string[]) {
  const info = await readBridgeTokenFile();
  if (!info) {
    return Response.json(UNAVAILABLE, { status: 503 });
  }
  const incoming = new URL(request.url);
  const target = `http://${info.host || "127.0.0.1"}:${info.port}/v1/${path.join("/")}${incoming.search}`;
  const headers = new Headers();
  headers.set("authorization", `Bearer ${info.token}`);
  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  try {
    const upstream = await fetch(target, {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
      // Node fetch requires duplex when forwarding a streamed body.
      duplex: "half",
    } as RequestInit);
    const responseHeaders = new Headers();
    const type = upstream.headers.get("content-type");
    if (type) responseHeaders.set("content-type", type);
    responseHeaders.set("cache-control", "no-store");
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
  } catch {
    return Response.json(UNAVAILABLE, { status: 503 });
  }
}

export async function GET(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  return proxy(request, path);
}

export async function POST(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  return proxy(request, path);
}
