import { prisma } from "./db.js";

export async function ensurePlannerTables() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS planned_study_blocks (
      id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id VARCHAR(191) NOT NULL,
      course_id VARCHAR(191) NOT NULL,
      activity_id VARCHAR(191) NULL,
      start_time DATETIME NOT NULL,
      end_time DATETIME NOT NULL,
      note TEXT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_planner_user_start (user_id, start_time),
      INDEX idx_planner_user_end (user_id, end_time)
    )
  `);
}
