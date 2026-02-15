import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

function minutes(ms: number) {
  return ms * 60_000;
}

async function main() {
  // Create a single user
  const user = await prisma.user.upsert({
    where: { id: "swot-user" },
    update: {},
    create: { id: "swot-user", name: "Nikol" },
  });

  await prisma.settings.upsert({
    where: { userId: user.id },
    update: {},
    create: {
      userId: user.id,
      cutoffTime: "05:00",
      soundsEnabled: true,
      shortSessionMinutes: 25,
      longSessionMinutes: 50,
      breakSessionMinutes: 5,
    },
  });

  const targets: Array<[number, number]> = [
    [1, 90],[2, 90],[3, 90],[4, 90],[5, 90],[6, 150],[7, 150],
  ];

  for (const [weekday, targetMinutes] of targets) {
    await prisma.dailyTarget.upsert({
      where: { userId_weekday: { userId: user.id, weekday } },
      update: { targetMinutes },
      create: { userId: user.id, weekday, targetMinutes },
    });
  }

  const german = await prisma.course.upsert({
    where: { userId_name: { userId: user.id, name: "German" } },
    update: {},
    create: { userId: user.id, name: "German" },
  });

  const java = await prisma.course.upsert({
    where: { userId_name: { userId: user.id, name: "Java" } },
    update: {},
    create: { userId: user.id, name: "Java" },
  });

  const math = await prisma.course.upsert({
    where: { userId_name: { userId: user.id, name: "Math" } },
    update: {},
    create: { userId: user.id, name: "Math" },
  });

  const vocab = await prisma.activity.upsert({
    where: { courseId_name: { courseId: german.id, name: "Vocabulary" } },
    update: {},
    create: { userId: user.id, courseId: german.id, name: "Vocabulary", color: "#ec4899" },
  });

  const coding = await prisma.activity.upsert({
    where: { courseId_name: { courseId: java.id, name: "Coding" } },
    update: {},
    create: { userId: user.id, courseId: java.id, name: "Coding", color: "#a855f7" },
  });

  const exercises = await prisma.activity.upsert({
    where: { courseId_name: { courseId: math.id, name: "Exercises" } },
    update: {},
    create: { userId: user.id, courseId: math.id, name: "Exercises", color: "#f97316" },
  });

  // Reset sessions so rerunning seed doesn't duplicate
  await prisma.studySession.deleteMany({ where: { userId: user.id } });

  const now = Date.now();
  const templates = [
    { courseId: german.id, activityId: vocab.id, mins: 40, breakM: 5, note: "Words + flashcards" },
    { courseId: java.id, activityId: coding.id, mins: 60, breakM: 0, note: "Coding practice" },
    { courseId: math.id, activityId: exercises.id, mins: 45, breakM: 5, note: "Exercises set" },
  ];

  // Make 15 sessions spread over last ~5 days
  for (let i = 0; i < 15; i++) {
    const t = templates[i % templates.length];
    const end = new Date(now - minutes(180 * i));
    const start = new Date(end.getTime() - minutes(t.mins + t.breakM));
    await prisma.studySession.create({
      data: {
        userId: user.id,
        courseId: t.courseId,
        activityId: t.activityId,
        startTime: start,
        endTime: end,
        breakMinutes: t.breakM,
        durationMinutes: t.mins,
        note: t.note,
      },
    });
  }

  console.log("Seeded ✅");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => prisma.$disconnect());
