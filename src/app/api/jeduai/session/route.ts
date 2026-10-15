import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureSeeded } from "@/lib/jeduai/seed";
import { getSessionUser, publicUser } from "@/lib/jeduai/auth";

export async function GET() {
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
