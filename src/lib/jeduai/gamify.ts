// JeduAI — gamification engine (points, badges, streaks) mirroring original service
import "server-only";
import { db } from "@/lib/db";
import { BADGES, POINT_RULES, todayStr, levelOf } from "./constants";

export async function recordActivity(
  userId: string,
  type: keyof typeof POINT_RULES | "zero",
  pointsOverride?: number,
  meta: Record<string, unknown> = {}
) {
  const points = pointsOverride ?? (type in POINT_RULES ? POINT_RULES[type as keyof typeof POINT_RULES] : 0);
  const day = todayStr();
  const user0 = await db.user.findUnique({ where: { id: userId } });
  if (!user0) return;

  // streak: consecutive active days
  let streak = user0.streak;
  if (user0.lastActiveDay !== day) {
    const yesterday = new Date(day + "T12:00:00");
    yesterday.setDate(yesterday.getDate() - 1);
    const yStr = todayStr(yesterday);
    streak = user0.lastActiveDay === yStr ? streak + 1 : 1;
  }

  const newPoints = user0.points + points;
  await db.user.update({
    where: { id: userId },
    data: { points: newPoints, streak, lastActiveDay: day },
  });

  await db.activity.create({
    data: { userId, type: String(type), points, meta: JSON.stringify(meta), day },
  });

  // badge check
  const owned = new Set(
    (await db.badge.findMany({ where: { userId }, select: { name: true } })).map((b) => b.name)
  );
  for (const b of BADGES) {
    if (newPoints >= b.points && !owned.has(b.name)) {
      await db.badge.create({ data: { userId, name: b.name, icon: b.icon, threshold: b.points } });
      await db.notification.create({
        data: {
          userId,
          title: "🏅 New Badge Unlocked!",
          body: `You earned "${b.name}" ${b.icon} — keep learning to reach the next one!`,
          kind: "achievement",
        },
      });
    }
  }
  return { points: newPoints, gained: points, ...levelOf(newPoints), streak };
}
