import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { createSession, destroySession, hashPassword, pickAvatarColor, publicUser, verifyPassword } from "@/lib/jeduai/auth";
import { ensureSeeded } from "@/lib/jeduai/seed";
import { recordActivity } from "@/lib/jeduai/gamify";
import { rateLimit } from "@/lib/jeduai/ratelimit";
import { LANG_NAMES, SUBJECTS } from "@/lib/jeduai/constants";

const signupSchema = z.object({
  action: z.literal("signup"),
  name: z.string().trim().min(2).max(60),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(100),
  role: z.enum(["Student", "Staff", "Admin"]).optional(),
  roleCode: z.string().max(40).optional(),
  interfaceLang: z.string().optional(),
  educationLevel: z.string().optional(),
  subjects: z.array(z.string()).optional(),
});

const loginSchema = z.object({
  action: z.literal("login"),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(req: NextRequest) {
  try {
    await ensureSeeded();
    const body = await req.json().catch(() => null);
    if (!body) return bad("Invalid request body");

    if (body.action === "login") {
      const parsed = loginSchema.safeParse(body);
      if (!parsed.success) return bad("Enter a valid email and password.");
      const { email, password } = parsed.data;
      const rl = rateLimit(`login:${email}`, 10, 60_000);
      if (!rl.ok) return bad("Too many attempts. Please wait a minute.", 429);
      const user = await db.user.findUnique({ where: { email } });
      if (!user || !verifyPassword(password, user.passwordHash)) return bad("Incorrect email or password.", 401);
      const token = await createSession(user.id);
      return NextResponse.json({ user: publicUser(user), token });
    }

    if (body.action === "logout") {
      await destroySession();
      return NextResponse.json({ ok: true });
    }

    if (body.action === "signup") {
      const parsed = signupSchema.safeParse(body);
      if (!parsed.success) return bad("Please fill all fields correctly (password: 8+ characters).");
      const { name, email, password, roleCode } = parsed.data;
      const rl = rateLimit(`signup:${email}`, 5, 60_000);
      if (!rl.ok) return bad("Too many signup attempts. Wait a minute.", 429);
      const exists = await db.user.findUnique({ where: { email } });
      if (exists) return bad("An account with this email already exists.", 409);

      // Only Staff/Admin creation requires a valid role code
      let role = "Student";
      if (body.role === "Staff" || body.role === "Admin") {
        const expected =
          body.role === "Staff"
            ? (process.env.STAFF_JOIN_CODE || "JEDU-STAFF")
            : (process.env.ADMIN_JOIN_CODE || "JEDU-ADMIN");
        if ((roleCode || "").trim().toUpperCase() !== expected.toUpperCase()) {
          return bad(`Enter a valid ${body.role} join code to create a ${body.role} account.`);
        }
        role = body.role;
      }

      const interfaceLang = parsed.data.interfaceLang && LANG_NAMES.includes(parsed.data.interfaceLang)
        ? parsed.data.interfaceLang : "English";
      const subjects = (parsed.data.subjects || []).filter((s) => (SUBJECTS as readonly string[]).includes(s)).slice(0, 8);

      const user = await db.user.create({
        data: {
          name,
          email,
          passwordHash: hashPassword(password),
          role,
          avatarColor: pickAvatarColor(email),
          interfaceLang,
          explanationLang: interfaceLang,
          educationLevel: parsed.data.educationLevel || "School",
          subjects: JSON.stringify(subjects),
          onboarded: false,
        },
      });
      const token = await createSession(user.id);
      await db.notification.create({
        data: {
          userId: user.id,
          title: "👋 Welcome to JeduAI!",
          body: "Learn in your language. Grow without limits.",
          kind: "system",
        },
      });
      await recordActivity(user.id, "signup");
      return NextResponse.json({ user: publicUser(user), token });
    }

    return bad("Unknown action");
  } catch (e) {
    return bad((e as Error).message || "Something went wrong", 500);
  }
}
