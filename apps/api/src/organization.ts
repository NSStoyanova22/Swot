import { prisma } from "./db.js";

export type ReminderRepeatRule = "none" | "daily" | "weekly";

function toDate(value: Date | string) {
  return value instanceof Date ? value : new Date(value);
}

export function computeNextReminderTrigger(
  remindAtValue: Date | string,
  repeatRule: ReminderRepeatRule,
  nowValue: Date | string
) {
  const remindAt = toDate(remindAtValue);
  const now = toDate(nowValue);
  if (repeatRule === "none") {
    return remindAt;
  }

  const intervalMs = repeatRule === "daily" ? 86_400_000 : 7 * 86_400_000;
  let next = new Date(remindAt);
  while (next.getTime() <= now.getTime()) {
    next = new Date(next.getTime() + intervalMs);
  }
  return next;
}

export async function ensureStudyOrganizationTables() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS schedule_blocks (
      id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id VARCHAR(191) NOT NULL,
      title VARCHAR(191) NOT NULL,
      note TEXT NULL,
      course_id VARCHAR(191) NULL,
      activity_id VARCHAR(191) NULL,
      day_of_week INT NOT NULL,
      start_time VARCHAR(5) NOT NULL,
      end_time VARCHAR(5) NOT NULL,
      rotation_interval_days INT NULL,
      rotation_offset INT NOT NULL DEFAULT 0,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_schedule_blocks_user_day (user_id, day_of_week, is_active)
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS tasks (
      id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id VARCHAR(191) NOT NULL,
      title VARCHAR(191) NOT NULL,
      description TEXT NULL,
      kind VARCHAR(32) NOT NULL DEFAULT 'task',
      status VARCHAR(32) NOT NULL DEFAULT 'todo',
      progress INT NOT NULL DEFAULT 0,
      priority VARCHAR(16) NOT NULL DEFAULT 'medium',
      due_at DATETIME NULL,
      course_id VARCHAR(191) NULL,
      activity_id VARCHAR(191) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_tasks_user_due (user_id, due_at),
      INDEX idx_tasks_user_status (user_id, status),
      INDEX idx_tasks_user_kind (user_id, kind)
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS task_subtasks (
      id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id VARCHAR(191) NOT NULL,
      task_id BIGINT NOT NULL,
      title VARCHAR(191) NOT NULL,
      done TINYINT(1) NOT NULL DEFAULT 0,
      sort_order INT NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_task_subtasks_task (task_id, sort_order),
      INDEX idx_task_subtasks_user (user_id)
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS reminders (
      id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id VARCHAR(191) NOT NULL,
      task_id BIGINT NULL,
      schedule_block_id BIGINT NULL,
      title VARCHAR(191) NOT NULL,
      remind_at DATETIME NOT NULL,
      repeat_rule VARCHAR(16) NOT NULL DEFAULT 'none',
      next_trigger_at DATETIME NULL,
      delivered TINYINT(1) NOT NULL DEFAULT 0,
      last_triggered_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_reminders_user_next (user_id, next_trigger_at, delivered),
      INDEX idx_reminders_user_remind_at (user_id, remind_at)
    )
  `);

  const spentMinutesColumn = await prisma.$queryRaw<Array<{ count: bigint | number }>>`
    SELECT COUNT(*) AS count
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'tasks'
      AND COLUMN_NAME = 'spent_minutes'
  `;

  const hasSpentMinutesColumn = Number(spentMinutesColumn[0]?.count ?? 0) > 0;
  if (!hasSpentMinutesColumn) {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE tasks
      ADD COLUMN spent_minutes INT NOT NULL DEFAULT 0
    `);
  }
}
