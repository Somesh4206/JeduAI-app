import { NextRequest, NextResponse } from "next/server";
import { readUpload } from "@/lib/jeduai/files";
import { db } from "@/lib/db";
import { getSessionUser, userFromToken } from "@/lib/jeduai/auth";

// Media elements cannot send an Authorization header, so this route (like the
// video file route) accepts the session token via ?t= for <audio>/<video> src.
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string; artifactId: string }> }) {
  try {
    const { id, artifactId } = await ctx.params;
    let user = await getSessionUser();
    if (!user) user = await userFromToken(req.nextUrl.searchParams.get("t"));
    if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

    const a = await db.notebookArtifact.findFirst({
      where: { id: artifactId, notebookId: id, userId: user.id },
      select: { fileKey: true, title: true },
    });
    if (!a || !a.fileKey) return NextResponse.json({ error: "File not found" }, { status: 404 });

    let buf: Buffer;
    try {
      buf = await readUpload(a.fileKey);
    } catch {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    const ext = (a.fileKey.split(".").pop() || "bin").toLowerCase();
    const type = ext === "mp3" ? "audio/mpeg" : ext === "mp4" ? "video/mp4" : "application/octet-stream";
    const total = buf.length;
    const download = req.nextUrl.searchParams.get("download") === "1";
    const slug =
      a.title
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 60) || "artifact";
    const disposition: Record<string, string> = download
      ? { "Content-Disposition": `attachment; filename="${slug}-${artifactId}.${ext}"` }
      : {};

    const range = req.headers.get("range");
    if (range) {
      const m = range.match(/bytes=(\d*)-(\d*)/);
      const start = m && m[1] ? parseInt(m[1], 10) : 0;
      const end = m && m[2] ? Math.min(parseInt(m[2], 10), total - 1) : total - 1;
      if (start >= total) {
        return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${total}` } });
      }
      const chunk = buf.subarray(start, end + 1);
      return new NextResponse(new Uint8Array(chunk), {
        status: 206,
        headers: {
          "Content-Type": type,
          "Content-Length": String(chunk.length),
          "Content-Range": `bytes ${start}-${end}/${total}`,
          "Accept-Ranges": "bytes",
          "Cache-Control": "private, max-age=3600",
          ...disposition,
        },
      });
    }
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": type,
        "Content-Length": String(total),
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, max-age=3600",
        ...disposition,
      },
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 401 });
  }
}
