const backendUrl = (process.env.CHATBOT_BACKEND_URL || "http://127.0.0.1:8000").replace(/\/$/, "");

export async function GET() {
  try {
    const upstream = await fetch(`${backendUrl}/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    const body = await upstream.json().catch(() => ({}));
    return Response.json(body, { status: upstream.status });
  } catch {
    return Response.json({ status: "unavailable" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 32_000) {
    return Response.json({ error: "Message history is too large." }, { status: 413 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON request." }, { status: 400 });
  }

  try {
    const upstream = await fetch(`${backendUrl}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: AbortSignal.timeout(180_000),
    });
    const body = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      const detail = typeof body?.error === "string"
        ? body.error
        : typeof body?.detail === "string"
          ? body.detail
          : "The chatbot service is unavailable.";
      return Response.json({ error: detail }, { status: upstream.status });
    }
    return Response.json(body, { status: upstream.status });
  } catch {
    return Response.json(
      { error: "The chatbot backend is unreachable. Start the backend and try again." },
      { status: 503 },
    );
  }
}
