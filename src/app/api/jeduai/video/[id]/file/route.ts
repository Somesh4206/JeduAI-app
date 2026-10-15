import { NextRequest, NextResponse } from "next/server";
import { readUpload } from "@/lib/jeduai/files";
import { db } from "@/lib/db";
import { getSessionUser, userFromToken } from "@/lib/jeduai/auth";

const MIME: Record<string, string> = {
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mkv: "video/x-matroska",
  avi: "video/x-msvideo",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  aac: "audio/aac",
  ogg: "audio/ogg",
  flac: "audio/flac",
};

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    // Media elements (<audio>/<video> src) cannot send an Authorization header,
    // so this route also accepts the session token via ?t= (needed when the app
    // runs in an iframe preview where cookies are blocked).
    let user = await getSessionUser();
    if (!user) user = await userFromToken(req.nextUrl.searchParams.get("t"));
    if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    const v = await db.videoProject.findFirst({ where: { id, userId: user.id } });
    if (!v || !v.fileKey) return NextResponse.json({ error: "File not found" }, { status: 404 });
    try {
      const buf = await readUpload(v.fileKey);
    } catch {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }
    const buf = await readUpload(v.fileKey);
    const ext = (v.fileKey.split(".").pop() || "bin").toLowerCase();
    const type = MIME[ext] || "application/octet-stream";
    const total = buf.length;
    const range = req.headers.get("range");
    if (range) {
      const m = range.match(/bytes=(\d*)-(\d*)/);
      const start = m && m[1] ? parseInt(m[1]) : 0;
      const end = m && m[2] ? Math.min(parseInt(m[2]), total - 1) : total - 1;
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
      },
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 401 });
  }
}
