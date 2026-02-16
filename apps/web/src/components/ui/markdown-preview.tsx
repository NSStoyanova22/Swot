import { cn } from '@/lib/utils'

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function renderInline(value: string) {
  const inlineCodes: string[] = []
  let text = value.replace(/`([^`\n]+)`/g, (_match, code: string) => {
    inlineCodes.push(`<code class="rounded bg-muted px-1 py-0.5 text-[0.85em]">${code}</code>`)
    return `@@IC${inlineCodes.length - 1}@@`
  })

  text = text.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noreferrer" class="text-primary underline underline-offset-2">$1</a>',
  )
  text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  text = text.replace(/__(.+?)__/g, '<strong>$1</strong>')
  text = text.replace(/\*(.+?)\*/g, '<em>$1</em>')
  text = text.replace(/_(.+?)_/g, '<em>$1</em>')

  return text.replace(/@@IC(\d+)@@/g, (_match, idx: string) => inlineCodes[Number(idx)] ?? '')
}

function markdownToHtml(markdown: string) {
  const escaped = escapeHtml(markdown)
  const codeBlocks: string[] = []

  let source = escaped.replace(/```([\s\S]*?)```/g, (_match, code: string) => {
    codeBlocks.push(`<pre class="overflow-x-auto rounded-md bg-muted p-3"><code>${code}</code></pre>`)
    return `@@CB${codeBlocks.length - 1}@@`
  })

  const lines = source.split('\n')
  const parts: string[] = []
  let inUl = false
  let inOl = false

  const closeLists = () => {
    if (inUl) {
      parts.push('</ul>')
      inUl = false
    }
    if (inOl) {
      parts.push('</ol>')
      inOl = false
    }
  }

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) {
      closeLists()
      continue
    }

    if (line.startsWith('@@CB') && line.endsWith('@@')) {
      closeLists()
      parts.push(line)
      continue
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/)
    if (heading) {
      closeLists()
      const level = heading[1].length
      parts.push(`<h${level} class="font-semibold">${renderInline(heading[2])}</h${level}>`)
      continue
    }

    const unordered = line.match(/^[-*]\s+(.+)$/)
    if (unordered) {
      if (inOl) {
        parts.push('</ol>')
        inOl = false
      }
      if (!inUl) {
        parts.push('<ul class="list-disc space-y-1 pl-5">')
        inUl = true
      }
      parts.push(`<li>${renderInline(unordered[1])}</li>`)
      continue
    }

    const ordered = line.match(/^\d+\.\s+(.+)$/)
    if (ordered) {
      if (inUl) {
        parts.push('</ul>')
        inUl = false
      }
      if (!inOl) {
        parts.push('<ol class="list-decimal space-y-1 pl-5">')
        inOl = true
      }
      parts.push(`<li>${renderInline(ordered[1])}</li>`)
      continue
    }

    closeLists()
    parts.push(`<p>${renderInline(line)}</p>`)
  }

  closeLists()

  const html = parts.join('\n')
  return html.replace(/@@CB(\d+)@@/g, (_match, idx: string) => codeBlocks[Number(idx)] ?? '')
}

export function MarkdownPreview({
  value,
  className,
  emptyLabel = 'No note yet.',
}: {
  value: string
  className?: string
  emptyLabel?: string
}) {
  const trimmed = value.trim()

  if (!trimmed) {
    return <p className={cn('text-sm text-muted-foreground', className)}>{emptyLabel}</p>
  }

  return (
    <div
      className={cn('space-y-2 text-sm leading-6 text-foreground [&_p]:m-0', className)}
      dangerouslySetInnerHTML={{ __html: markdownToHtml(trimmed) }}
    />
  )
}
