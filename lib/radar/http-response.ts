import { NextResponse } from "next/server";

export function jsonOk(data: unknown, maxAgeSec = 0) {
  return NextResponse.json(data, {
    headers: {
      "Cache-Control": maxAgeSec > 0 ? `private, max-age=${maxAgeSec}` : "no-store",
    },
  });
}

export function jsonError(err: unknown, status = 502) {
  const message = err instanceof Error ? err.message : String(err);
  console.error("[radar api]", message);
  return NextResponse.json(
    { error: message },
    { status, headers: { "Cache-Control": "no-store" } }
  );
}
