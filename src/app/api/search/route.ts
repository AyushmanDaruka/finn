import { search } from "@/lib/screener";

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q")?.trim();
  if (!q || q.length < 2) return Response.json([]);
  try {
    return Response.json(await search(q), { headers: { "Cache-Control": "s-maxage=86400" } });
  } catch {
    return Response.json([]);
  }
}
