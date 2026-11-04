import { getAsset } from "@/lib/assets";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const asset = await getAsset(id);
  if (!asset) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(asset.bytes), {
    headers: {
      "Content-Type": asset.type,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      // Uploaded SVGs are inert when opened directly.
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
