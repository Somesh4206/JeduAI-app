// JeduAI — idempotent demo seed (clearly-labeled demo accounts; no fake activity history)
import "server-only";
import { db } from "@/lib/db";
import { hashPassword, pickAvatarColor } from "./auth";

let seeding: Promise<void> | null = null;

export function ensureSeeded() {
  if (!seeding) seeding = seed().catch((e) => { seeding = null; throw e; });
  return seeding;
}

async function seed() {
  const count = await db.user.count();
  if (count > 0) return;

  const pw = hashPassword("JeduAI@123");
  const admin = await db.user.create({
    data: {
      email: "admin@jeduai.app",
      passwordHash: pw,
      name: "Dr. Meera Iyer",
      role: "Admin",
      avatarColor: pickAvatarColor("admin@jeduai.app"),
      educationLevel: "University",
      onboarded: true,
      subjects: JSON.stringify(["General Knowledge"]),
      isDemo: true,
    },
  });
  const staff = await db.user.create({
    data: {
      email: "staff@jeduai.app",
      passwordHash: pw,
      name: "Ms. Priya Sharma",
      role: "Staff",
      avatarColor: pickAvatarColor("staff@jeduai.app"),
      educationLevel: "University",
      onboarded: true,
      subjects: JSON.stringify(["Mathematics", "Physics"]),
      isDemo: true,
    },
  });
  const student = await db.user.create({
    data: {
      email: "student@jeduai.app",
      passwordHash: pw,
      name: "Aarav Kumar",
      role: "Student",
      avatarColor: pickAvatarColor("student@jeduai.app"),
      educationLevel: "College",
      onboarded: true,
      explanationLang: "English",
      interfaceLang: "English",
      subjects: JSON.stringify(["Mathematics", "Physics", "Computer Science"]),
      dailyGoalMin: 30,
      isDemo: true,
    },
  });

  // One clearly-labeled demo class and demo assessment (created by demo staff)
  const tomorrow = new Date(Date.now() + 24 * 3600_000);
  tomorrow.setHours(17, 0, 0, 0);
  await db.onlineClass.create({
    data: {
      teacherId: staff.id,
      title: "Demo Class: Quadratic Equations Revision",
      subject: "Mathematics",
      description: "Sample class seeded for demo. Replace with your own by signing in as staff.",
      scheduledAt: tomorrow,
      durationMin: 45,
      meetingLink: "https://meet.jit.si/jeduai-demo-class",
      status: "scheduled",
      classCode: "JEDUDEMO",
    },
  });
  await db.assessment.create({
    data: {
      authorId: staff.id,
      title: "Demo Assessment: Kinematics Basics",
      subject: "Physics",
      description: "Sample assessment seeded for demo.",
      totalMarks: 10,
      status: "published",
      questions: JSON.stringify([
        {
          question: "A body starts from rest and accelerates at 2 m/s². What distance does it cover in 5 s?",
          options: ["10 m", "25 m", "50 m", "5 m"],
          correctIndex: 1,
          explanation: "s = ut + ½at² = 0 + ½·2·25 = 25 m.",
        },
        {
          question: "Which quantity is a vector?",
          options: ["Speed", "Distance", "Velocity", "Time"],
          correctIndex: 2,
          explanation: "Velocity has both magnitude and direction, so it is a vector.",
        },
      ]),
    },
  });
  for (const u of [admin, staff, student]) {
    await db.notification.create({
      data: {
        userId: u.id,
        title: "👋 Welcome to JeduAI!",
        body: "Demo account ready. Explore the AI tutor, translation and media tools.",
        kind: "system",
      },
    });
  }

  // Starter vocabulary for the demo student (English terms, simple meanings)
  const now = Date.now();
  const starterVocab: { term: string; meaning: string; example: string; source: string; box: number; dueAt: Date }[] = [
    { term: "photosynthesis", meaning: "how plants turn sunlight into food", example: "Photosynthesis happens in the leaves.", source: "translation", box: 2, dueAt: new Date(now - 3600_000) },
    { term: "velocity", meaning: "speed in a given direction", example: "The car's velocity changed as it turned.", source: "tutor", box: 3, dueAt: new Date(now + 86400_000) },
    { term: "gravity", meaning: "the force that pulls things down", example: "Gravity keeps the moon in orbit.", source: "tutor", box: 1, dueAt: new Date(now - 60_000) },
    { term: "algorithm", meaning: "a step-by-step method to solve a problem", example: "This algorithm sorts numbers fast.", source: "tutor", box: 2, dueAt: new Date(now + 2 * 86400_000) },
    { term: "metaphor", meaning: "a comparison without using 'like'", example: "'Time is money' is a metaphor.", source: "manual", box: 4, dueAt: new Date(now + 6 * 86400_000) },
  ];
  for (const w of starterVocab) {
    await db.vocabWord.create({
      data: { userId: student.id, term: w.term, meaning: w.meaning, example: w.example, lang: "English", meaningLang: "English", source: w.source, box: w.box, dueAt: w.dueAt, mastered: w.box >= 5 },
    });
  }
}
