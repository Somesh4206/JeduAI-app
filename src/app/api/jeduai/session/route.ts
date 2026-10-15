import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureSeeded } from "@/lib/jeduai/seed";
import { getSessionUser, publicUser } from "@/lib/jeduai/auth";

export async function GET(request: Request) {
  // Capture the public origin this deployment is reached through (for APK default-URL baking).
  try {
    const h = request.headers.get("host") ?? "";
    if (h && !/^(localhost|127\.|\[::1\]|0\.0\.0\.0)/.test(h)) {
      console.log(`[origin] ${request.headers.get("x-forwarded-proto") ?? "http"}://${h}`);
    }
  } catch { /* logging only */ }
  try {
    await ensureSeeded();
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ user: null });
    const unread = await db.notification.count({ where: { userId: user.id, read: false } });
    return NextResponse.json({ user: publicUser(user), unread });
  } catch (e) {
    return NextResponse.json({ user: null, error: (e as Error).message }, { status: 200 });
  }
}
