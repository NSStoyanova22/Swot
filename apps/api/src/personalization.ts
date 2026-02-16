import { prisma } from "./db.js";

export type UiPreferences = {
  workspaceName: string;
  avatar: string;
  accentColor: string;
  dashboardBackground: string;
  themePreset: "pink" | "purple" | "dark" | "minimal";
  widgetStyle: "soft" | "glass" | "flat";
  layoutDensity: "comfortable" | "compact" | "cozy";
};

export const defaultUiPreferences: UiPreferences = {
  workspaceName: "Study Hub",
  avatar: "✨",
  accentColor: "#e11d77",
  dashboardBackground:
    "radial-gradient(circle at 0% 0%, rgba(253, 220, 229, 0.7), transparent 38%), radial-gradient(circle at 95% 10%, rgba(252, 231, 243, 0.7), transparent 34%)",
  themePreset: "pink",
  widgetStyle: "soft",
  layoutDensity: "comfortable",
};

export async function ensurePersonalizationTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS user_ui_preferences (
      user_id VARCHAR(191) NOT NULL PRIMARY KEY,
      workspace_name VARCHAR(120) NOT NULL DEFAULT 'Study Hub',
      avatar VARCHAR(32) NOT NULL DEFAULT '✨',
      accent_color VARCHAR(16) NOT NULL DEFAULT '#e11d77',
      dashboard_background TEXT NULL,
      theme_preset VARCHAR(32) NOT NULL DEFAULT 'pink',
      widget_style VARCHAR(32) NOT NULL DEFAULT 'soft',
      layout_density VARCHAR(32) NOT NULL DEFAULT 'comfortable',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);
}

export async function getUiPreferences(userId: string): Promise<UiPreferences> {
  const rows = await prisma.$queryRaw<
    Array<{
      workspace_name: string;
      avatar: string;
      accent_color: string;
      dashboard_background: string | null;
      theme_preset: string;
      widget_style: string;
      layout_density: string;
    }>
  >`
    SELECT workspace_name, avatar, accent_color, dashboard_background, theme_preset, widget_style, layout_density
    FROM user_ui_preferences
    WHERE user_id = ${userId}
    LIMIT 1
  `;

  const row = rows[0];
  if (!row) return defaultUiPreferences;
  return {
    workspaceName: row.workspace_name || defaultUiPreferences.workspaceName,
    avatar: row.avatar || defaultUiPreferences.avatar,
    accentColor: row.accent_color || defaultUiPreferences.accentColor,
    dashboardBackground:
      row.dashboard_background || defaultUiPreferences.dashboardBackground,
    themePreset:
      row.theme_preset === "purple" ||
      row.theme_preset === "dark" ||
      row.theme_preset === "minimal"
        ? row.theme_preset
        : "pink",
    widgetStyle:
      row.widget_style === "glass" || row.widget_style === "flat"
        ? row.widget_style
        : "soft",
    layoutDensity:
      row.layout_density === "compact" || row.layout_density === "cozy"
        ? row.layout_density
        : "comfortable",
  };
}

export async function upsertUiPreferences(
  userId: string,
  prefs: Partial<UiPreferences>
) {
  const current = await getUiPreferences(userId);
  const next: UiPreferences = {
    ...current,
    ...prefs,
  };

  await prisma.$executeRaw`
    INSERT INTO user_ui_preferences (
      user_id, workspace_name, avatar, accent_color, dashboard_background, theme_preset, widget_style, layout_density
    )
    VALUES (
      ${userId},
      ${next.workspaceName},
      ${next.avatar},
      ${next.accentColor},
      ${next.dashboardBackground},
      ${next.themePreset},
      ${next.widgetStyle},
      ${next.layoutDensity}
    )
    ON DUPLICATE KEY UPDATE
      workspace_name = VALUES(workspace_name),
      avatar = VALUES(avatar),
      accent_color = VALUES(accent_color),
      dashboard_background = VALUES(dashboard_background),
      theme_preset = VALUES(theme_preset),
      widget_style = VALUES(widget_style),
      layout_density = VALUES(layout_density)
  `;

  return getUiPreferences(userId);
}

