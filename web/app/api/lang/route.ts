export async function GET(req: Request) {
  const url = new URL(req.url);
  const to = url.searchParams.get("to") === "pcm" ? "pcm" : "en";
  const back = req.headers.get("referer") ?? "/";
  return new Response(null, {
    status: 303,
    headers: { location: back, "set-cookie": `lang=${to}; Path=/; Max-Age=31536000; SameSite=Lax` },
  });
}
