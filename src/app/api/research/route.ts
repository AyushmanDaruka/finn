// Pull: streams progress as NDJSON, then the finished research. Precomputed demo names return instantly;
// any other ticker runs live and is cached for the life of the instance.
import { readFile } from "fs/promises";
import path from "path";
import { research, type Research } from "@/lib/research";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

const mem = new Map<string, Research>();

export async function GET(req: Request) {
  const symbol = new URL(req.url).searchParams.get("symbol")?.toUpperCase().replace(/[^A-Z0-9&-]/g, "");
  if (!symbol) return Response.json({ error: "symbol required" }, { status: 400 });

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctrl) {
      const send = (o: object) => ctrl.enqueue(enc.encode(JSON.stringify(o) + "\n"));
      try {
        let r = mem.get(symbol);
        if (!r) {
          r = await readFile(path.join(process.cwd(), "data/research", `${symbol}.json`), "utf8").then(JSON.parse).catch(() => undefined);
          if (r) send({ type: "progress", msg: "Loaded from cache" });
        }
        if (!r) {
          r = await research(symbol, (msg) => send({ type: "progress", msg }));
          mem.set(symbol, r);
        }
        send({ type: "done", data: r });
      } catch (e) {
        const msg = String((e as Error).message);
        send({ type: "error", msg: msg.startsWith("404") ? `No listed company found for "${symbol}"` : msg });
      }
      ctrl.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" } });
}
