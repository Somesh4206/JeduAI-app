import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { destroySession, publicUser, requireUser } from "@/lib/jeduai/auth";
import { LANG_NAMES, EDUCATION_LEVELS, SUBJECTS, AVATAR_COLORS } from "@/lib/jeduai/constants";

const patchSchema = z.object({
  name: z.string().trim().min(2).max(60).optional(),
  educationLevel: z.enum(EDUCATION_LEVELS).optional(),
  interfaceLang: z.string().optional(),
  explanationLang: z.string().optional(),
  subjects: z.array(z.string()).optional(),
  interests: z.array(z.string()).optional(),
  dailyGoalMin: z.number().int().min(5).max(480).optional(),
  theme: z.enum(["light", "dark"]).optional(),
  fontScale: z.number().min(0.85).max(1.4).optional(),
  onboarded: z.boolean().optional(),
  notifPrefs: z.record(z.string(), z.unknown()).optional(),
  avatarColor: z.string().optional(),
  profileImage: z.string().nullable().optional(),
});

export async function PATCH(req: NextRequest) {
  try {
    const user = await requireUser();
    const parsed = patchSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Invalid profile data" }, { status: 400 });
    const d = parsed.data;
    const data: Record<string, unknown> = {};
    if (d.name) data.name = d.name;
    if (d.educationLevel) data.educationLevel = d.educationLevel;
    if (d.interfaceLang && LANG_NAMES.includes(d.interfaceLang)) data.interfaceLang = d.interfaceLang;
    if (d.explanationLang && LANG_NAMES.includes(d.explanationLang)) data.explanationLang = d.explanationLang;
    if (d.subjects) data.subjects = JSON.stringify(d.subjects.filter((s) => (SUBJECTS as readonly string[]).includes(s)).slice(0, 10));
    if (d.interests) data.interests = JSON.stringify(d.interests.slice(0, 10));
    if (typeof d.dailyGoalMin === "number") data.dailyGoalMin = d.dailyGoalMin;
    if (d.theme) data.theme = d.theme;
    if (typeof d.fontScale === "number") data.fontScale = d.fontScale;
    if (typeof d.onboarded === "boolean") data.onboarded = d.onboarded;
    if (d.notifPrefs) data.notifPrefs = JSON.stringify(d.notifPrefs);
    if (d.avatarColor && AVATAR_COLORS.includes(d.avatarColor)) data.avatarColor = d.avatarColor;
    if (d.profileImage === null || typeof d.profileImage === "string") data.profileImage = d.profileImage;
    if (!Object.keys(data).length) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    const updated = await db.user.update({ where: { id: user.id }, data });
    return NextResponse.json({ user: publicUser(updated) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 401 });
  }
}

export async function DELETE() {
  try {
    const user = await requireUser();
    // cascade wipes all owned content
    await db.user.delete({ where: { id: user.id } });
    await destroySession();
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 401 });
  }
}
