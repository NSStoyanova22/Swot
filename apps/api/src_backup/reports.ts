import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'

import { getAnalyticsInsights } from './insights.js'
import { getAnalyticsPrediction } from './analytics-prediction.js'
import { prisma } from './db.js'
import { getProductivityOverview } from './productivity.js'
import { getStreakOverview } from './streak.js'

function formatMinutes(value: number) {
  if (value < 60) return `${Math.round(value)}m`
  const hours = Math.floor(value / 60)
  const minutes = Math.round(value % 60)
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`
}

function dateLabel(dateValue: Date) {
  return dateValue.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function wrapText(text: string, maxChars = 94) {
  const words = text.split(/\s+/).filter(Boolean)
  if (words.length === 0) return ['']

  const lines: string[] = []
  let current = ''

  for (const word of words) {
    const candidate = current.length === 0 ? word : `${current} ${word}`
    if (candidate.length <= maxChars) {
      current = candidate
    } else {
      lines.push(current)
      current = word
    }
  }

  if (current.length > 0) lines.push(current)
  return lines
}

export async function generateStudyReportPdf(userId: string) {
  const [sessions, streak, productivity, insights, prediction] = await Promise.all([
    prisma.studySession.findMany({
      where: { userId },
      include: { course: true, activity: true },
      orderBy: { startTime: 'desc' },
    }),
    getStreakOverview(userId),
    getProductivityOverview(userId),
    getAnalyticsInsights(userId),
    getAnalyticsPrediction(userId),
  ])

  const totalStudyMinutes = sessions.reduce((sum, session) => sum + session.durationMinutes, 0)
  const courseTotals = new Map<string, number>()
  const weekdayTotals = [0, 0, 0, 0, 0, 0, 0]

  sessions.forEach((session) => {
    const courseName = session.course?.name ?? 'Unknown'
    courseTotals.set(courseName, (courseTotals.get(courseName) ?? 0) + session.durationMinutes)
    const dayIndex = (new Date(session.startTime).getDay() + 6) % 7
    weekdayTotals[dayIndex] = (weekdayTotals[dayIndex] ?? 0) + session.durationMinutes
  })

  const topCourses = Array.from(courseTotals.entries())
    .map(([name, minutes]) => ({ name, minutes }))
    .sort((a, b) => b.minutes - a.minutes)
    .slice(0, 6)

  const recentSessions = sessions.slice(0, 12)
  const weekdayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

  const pdfDoc = await PDFDocument.create()
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)

  const pageWidth = 595
  const pageHeight = 842
  const margin = 42
  const maxWidth = pageWidth - margin * 2

  let page = pdfDoc.addPage([pageWidth, pageHeight])
  let y = pageHeight - margin

  const ensureSpace = (heightNeeded: number) => {
    if (y - heightNeeded < margin) {
      page = pdfDoc.addPage([pageWidth, pageHeight])
      y = pageHeight - margin
    }
  }

  const drawTextLine = (
    text: string,
    options: {
      size?: number
      color?: ReturnType<typeof rgb>
      fontRef?: PDFFont
      x?: number
      lineGap?: number
    } = {},
  ) => {
    const size = options.size ?? 11
    const lineGap = options.lineGap ?? 4
    ensureSpace(size + lineGap)
    page.drawText(text, {
      x: options.x ?? margin,
      y: y - size,
      size,
      font: options.fontRef ?? font,
      color: options.color ?? rgb(0.18, 0.15, 0.2),
    })
    y -= size + lineGap
  }

  const drawSectionTitle = (text: string) => {
    y -= 8
    drawTextLine(text, {
      size: 14,
      fontRef: bold,
      color: rgb(0.72, 0.1, 0.4),
      lineGap: 6,
    })
    page.drawRectangle({
      x: margin,
      y: y - 2,
      width: maxWidth,
      height: 1.2,
      color: rgb(0.94, 0.81, 0.87),
    })
    y -= 8
  }

  const drawParagraph = (text: string) => {
    const lines = wrapText(text, 98)
    lines.forEach((line) => drawTextLine(line, { size: 10.5, color: rgb(0.32, 0.28, 0.36) }))
  }

  const drawBarChart = (title: string, items: Array<{ label: string; value: number }>) => {
    drawTextLine(title, { size: 12, fontRef: bold, color: rgb(0.28, 0.24, 0.32), lineGap: 6 })
    const chartHeight = Math.max(90, items.length * 18 + 18)
    ensureSpace(chartHeight + 8)

    const maxValue = Math.max(1, ...items.map((item) => item.value))
    const xStart = margin + 110
    const chartWidth = maxWidth - 120
    let cursorY = y

    items.forEach((item, index) => {
      const barWidth = (item.value / maxValue) * chartWidth
      const rowY = cursorY - index * 18
      page.drawText(item.label, {
        x: margin,
        y: rowY - 9,
        size: 9,
        font,
        color: rgb(0.31, 0.28, 0.35),
      })
      page.drawRectangle({
        x: xStart,
        y: rowY - 10,
        width: barWidth,
        height: 10,
        color: rgb(0.88, 0.2, 0.5),
      })
      page.drawText(formatMinutes(item.value), {
        x: xStart + barWidth + 4,
        y: rowY - 9,
        size: 8.5,
        font,
        color: rgb(0.35, 0.3, 0.38),
      })
    })

    y -= chartHeight + 6
  }

  drawTextLine('Swot Study Report', {
    size: 22,
    fontRef: bold,
    color: rgb(0.75, 0.12, 0.45),
    lineGap: 4,
  })
  drawTextLine(`Generated on ${new Date().toLocaleString()}`, {
    size: 10,
    color: rgb(0.47, 0.4, 0.5),
    lineGap: 12,
  })

  drawSectionTitle('Overview')
  drawTextLine(`Total study time: ${formatMinutes(totalStudyMinutes)}`, { fontRef: bold })
  drawTextLine(`Total sessions: ${sessions.length}`)
  drawTextLine(`Current streak: ${streak.currentStreak} day(s)`)
  drawTextLine(`Longest streak: ${streak.longestStreak} day(s)`)
  drawTextLine(`Missed days: ${streak.missedDays}`)
  drawTextLine(`Today productivity: ${productivity.todayScore}/100`)
  drawTextLine(`Weekly productivity average: ${Math.round(productivity.weeklyAverage)}/100`)

  drawSectionTitle('Prediction & Insights')
  drawTextLine(
    `Next-day probability: ${Math.round(prediction.studyProbability * 100)}%  |  Predicted minutes: ${formatMinutes(
      prediction.predictedMinutes,
    )}`,
    { fontRef: bold },
  )
  drawTextLine(`Prediction confidence: ${prediction.confidenceScore}/100`)
  drawParagraph(prediction.explanation)
  drawTextLine(
    `Best study weekday: ${insights.bestStudyWeekday?.label ?? 'N/A'} (${formatMinutes(
      insights.bestStudyWeekday?.minutes ?? 0,
    )})`,
  )
  drawTextLine(
    `Best study hour range: ${insights.bestStudyHourRange?.label ?? 'N/A'} (${formatMinutes(
      insights.bestStudyHourRange?.minutes ?? 0,
    )})`,
  )
  drawTextLine(`Recommended break frequency: every ${insights.recommendedBreakFrequencyMinutes} minutes`)
  drawParagraph(insights.explanation)

  drawSectionTitle('Charts')
  drawBarChart(
    'Course breakdown (top courses)',
    topCourses.map((course) => ({ label: course.name, value: course.minutes })),
  )
  drawBarChart(
    'Weekday study minutes',
    weekdayLabels.map((day, index) => ({ label: day, value: weekdayTotals[index] ?? 0 })),
  )

  drawSectionTitle('Recent Sessions')
  if (recentSessions.length === 0) {
    drawTextLine('No sessions logged yet.', { color: rgb(0.4, 0.35, 0.43) })
  } else {
    recentSessions.forEach((session) => {
      ensureSpace(24)
      const line = `${dateLabel(new Date(session.startTime))}  •  ${session.course?.name ?? 'Course'}  •  ${formatMinutes(
        session.durationMinutes,
      )}`
      drawTextLine(line, { size: 10.5, fontRef: bold, lineGap: 2 })
      const context = `${session.activity?.name ? `${session.activity.name} • ` : ''}${session.note ?? 'No note'}`
      drawParagraph(context.slice(0, 220))
      y -= 2
    })
  }

  const bytes = await pdfDoc.save()
  return bytes
}
