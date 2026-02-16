import { useState } from 'react'
import { Eye, Pencil } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { MarkdownPreview } from '@/components/ui/markdown-preview'
import { Textarea } from '@/components/ui/textarea'

export function MarkdownNoteEditor({
  label = 'Note',
  value,
  onChange,
  placeholder = 'Write your note in Markdown...',
}: {
  label?: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
}) {
  const [preview, setPreview] = useState(false)

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <label className="text-sm font-medium">{label}</label>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            size="sm"
            variant={preview ? 'ghost' : 'outline'}
            className="h-8 px-2.5"
            onClick={() => setPreview(false)}
          >
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </Button>
          <Button
            type="button"
            size="sm"
            variant={preview ? 'outline' : 'ghost'}
            className="h-8 px-2.5"
            onClick={() => setPreview(true)}
          >
            <Eye className="h-3.5 w-3.5" />
            Preview
          </Button>
        </div>
      </div>

      {preview ? (
        <div className="min-h-[120px] rounded-md border border-input bg-background/70 p-3">
          <MarkdownPreview value={value} emptyLabel="Nothing to preview yet." />
        </div>
      ) : (
        <Textarea value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
      )}
    </div>
  )
}
