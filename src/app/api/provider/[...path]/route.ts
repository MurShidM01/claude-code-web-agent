import { handleProviderRequest } from "@/lib/providers/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

async function handle(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const url = new URL(request.url);
  let body: unknown = {};
  if (request.method !== "GET" && request.method !== "HEAD") {
    body = await request.json().catch(() => ({}));
  }
  const result = await handleProviderRequest({
    method: request.method,
    pathname: `/${path.join("/")}`,
    searchParams: url.searchParams,
    body,
    signal: request.signal,
  });
  if (result.kind === "json") {
    return Response.json(result.body, { status: result.status, headers: { "cache-control": "no-store" } });
  }
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of result.events) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "The provider stream failed.";
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "error", message, retryable: true })}\n\n`));
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store" },
  });
}

export function GET(request: Request, context: { params: Promise<{ path: string[] }> }) {
  return handle(request, context);
}

export function POST(request: Request, context: { params: Promise<{ path: string[] }> }) {
  return handle(request, context);
}
