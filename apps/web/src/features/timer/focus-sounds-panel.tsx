import { useEffect, useRef, useState } from 'react'
import { Pause, Play, Volume2 } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useFocusSoundPreferences } from '@/hooks/use-focus-sound-preferences'
import type { FocusSoundId } from '@/lib/focus-sound'

type SoundEngine = {
  stop: () => void
  setVolume: (volume: number) => void
}

function createBufferSource(
  context: AudioContext,
  options: {
    durationSeconds: number
    generator: (index: number, previous: number) => number
  },
) {
  const sampleRate = context.sampleRate
  const buffer = context.createBuffer(1, sampleRate * options.durationSeconds, sampleRate)
  const channel = buffer.getChannelData(0)
  let previous = 0
  for (let i = 0; i < channel.length; i += 1) {
    const next = options.generator(i, previous)
    channel[i] = next
    previous = next
  }
  const source = context.createBufferSource()
  source.buffer = buffer
  source.loop = true
  return source
}

function createWhiteNoiseEngine(context: AudioContext, initialVolume: number): SoundEngine {
  const gain = context.createGain()
  gain.gain.value = initialVolume
  gain.connect(context.destination)

  const source = createBufferSource(context, {
    durationSeconds: 2,
    generator: () => Math.random() * 2 - 1,
  })
  source.connect(gain)
  source.start()

  return {
    stop: () => {
      source.stop()
      source.disconnect()
      gain.disconnect()
    },
    setVolume: (volume) => {
      gain.gain.value = volume
    },
  }
}

function createBrownNoiseEngine(context: AudioContext, initialVolume: number): SoundEngine {
  const gain = context.createGain()
  gain.gain.value = initialVolume
  gain.connect(context.destination)

  const source = createBufferSource(context, {
    durationSeconds: 3,
    generator: (_index, previous) => {
      const white = Math.random() * 2 - 1
      const next = (previous + 0.02 * white) / 1.02
      return Math.max(-1, Math.min(1, next * 3.2))
    },
  })
  const filter = context.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = 600

  source.connect(filter)
  filter.connect(gain)
  source.start()

  return {
    stop: () => {
      source.stop()
      source.disconnect()
      filter.disconnect()
      gain.disconnect()
    },
    setVolume: (volume) => {
      gain.gain.value = volume
    },
  }
}

function createRainNoiseEngine(context: AudioContext, initialVolume: number): SoundEngine {
  const gain = context.createGain()
  gain.gain.value = initialVolume
  gain.connect(context.destination)

  const source = createBufferSource(context, {
    durationSeconds: 2,
    generator: () => (Math.random() * 2 - 1) * 0.8,
  })
  const highPass = context.createBiquadFilter()
  highPass.type = 'highpass'
  highPass.frequency.value = 700
  const lowPass = context.createBiquadFilter()
  lowPass.type = 'lowpass'
  lowPass.frequency.value = 7800

  const modulator = context.createOscillator()
  modulator.type = 'sine'
  modulator.frequency.value = 0.17
  const modGain = context.createGain()
  modGain.gain.value = 0.12
  modulator.connect(modGain)
  modGain.connect(gain.gain)

  source.connect(highPass)
  highPass.connect(lowPass)
  lowPass.connect(gain)
  source.start()
  modulator.start()

  return {
    stop: () => {
      source.stop()
      modulator.stop()
      source.disconnect()
      highPass.disconnect()
      lowPass.disconnect()
      modulator.disconnect()
      modGain.disconnect()
      gain.disconnect()
    },
    setVolume: (volume) => {
      gain.gain.value = volume
    },
  }
}

function createCafeEngine(context: AudioContext, initialVolume: number): SoundEngine {
  const gain = context.createGain()
  gain.gain.value = initialVolume
  gain.connect(context.destination)

  const ambience = createBufferSource(context, {
    durationSeconds: 4,
    generator: () => (Math.random() * 2 - 1) * 0.5,
  })
  const ambienceFilter = context.createBiquadFilter()
  ambienceFilter.type = 'bandpass'
  ambienceFilter.frequency.value = 900
  ambienceFilter.Q.value = 0.6

  const hum = context.createOscillator()
  hum.type = 'sine'
  hum.frequency.value = 145
  const humGain = context.createGain()
  humGain.gain.value = 0.08

  const chatter = context.createOscillator()
  chatter.type = 'triangle'
  chatter.frequency.value = 220
  const chatterGain = context.createGain()
  chatterGain.gain.value = 0.035

  ambience.connect(ambienceFilter)
  ambienceFilter.connect(gain)
  hum.connect(humGain)
  humGain.connect(gain)
  chatter.connect(chatterGain)
  chatterGain.connect(gain)

  ambience.start()
  hum.start()
  chatter.start()

  return {
    stop: () => {
      ambience.stop()
      hum.stop()
      chatter.stop()
      ambience.disconnect()
      ambienceFilter.disconnect()
      hum.disconnect()
      humGain.disconnect()
      chatter.disconnect()
      chatterGain.disconnect()
      gain.disconnect()
    },
    setVolume: (volume) => {
      gain.gain.value = volume
    },
  }
}

const soundOptions: Array<{ id: FocusSoundId; label: string }> = [
  { id: 'white', label: '🤍 White noise' },
  { id: 'rain', label: '🌧️ Rain' },
  { id: 'cafe', label: '☕ Cafe ambience' },
  { id: 'brown', label: '🟤 Brown noise' },
  { id: 'youtube', label: '🎧 YouTube lo-fi' },
]

export function FocusSoundsPanel() {
  const { preferences, updatePreferences } = useFocusSoundPreferences()
  const [isPlaying, setIsPlaying] = useState(false)
  const audioContextRef = useRef<AudioContext | null>(null)
  const engineRef = useRef<SoundEngine | null>(null)

  const stopEngine = () => {
    if (engineRef.current) {
      engineRef.current.stop()
      engineRef.current = null
    }
  }

  const ensureAudioContext = async () => {
    if (!audioContextRef.current) {
      audioContextRef.current = new window.AudioContext()
    }
    if (audioContextRef.current.state === 'suspended') {
      await audioContextRef.current.resume()
    }
    return audioContextRef.current
  }

  const startSelectedSound = async () => {
    if (preferences.selectedSound === 'youtube') {
      setIsPlaying(true)
      return
    }

    const context = await ensureAudioContext()
    stopEngine()

    const engine =
      preferences.selectedSound === 'white'
        ? createWhiteNoiseEngine(context, preferences.volume)
        : preferences.selectedSound === 'rain'
          ? createRainNoiseEngine(context, preferences.volume)
          : preferences.selectedSound === 'cafe'
            ? createCafeEngine(context, preferences.volume)
            : createBrownNoiseEngine(context, preferences.volume)

    engineRef.current = engine
    setIsPlaying(true)
  }

  const pauseSelectedSound = () => {
    stopEngine()
    setIsPlaying(false)
  }

  useEffect(() => {
    if (!isPlaying) return
    if (preferences.selectedSound === 'youtube') return
    engineRef.current?.setVolume(preferences.volume)
  }, [isPlaying, preferences.selectedSound, preferences.volume])

  useEffect(() => {
    return () => {
      stopEngine()
      if (audioContextRef.current) {
        void audioContextRef.current.close()
      }
    }
  }, [])

  return (
    <Card className="w-full shadow-soft">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          🎵 Focus Sounds
        </CardTitle>
        <CardDescription>
          Stay in flow with gentle ambience. Sounds are lazy-loaded on first play.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {soundOptions.map((option) => (
            <Button
              key={option.id}
              variant={preferences.selectedSound === option.id ? 'default' : 'outline'}
              onClick={async () => {
                const previous = preferences.selectedSound
                updatePreferences({ selectedSound: option.id })
                if (isPlaying) {
                  if (option.id === 'youtube') {
                    stopEngine()
                    setIsPlaying(true)
                  } else if (previous === 'youtube') {
                    await startSelectedSound()
                  } else {
                    await startSelectedSound()
                  }
                }
              }}
            >
              {option.label}
            </Button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {!isPlaying ? (
            <Button onClick={() => void startSelectedSound()}>
              <Play className="h-4 w-4" />
              Play
            </Button>
          ) : (
            <Button variant="secondary" onClick={pauseSelectedSound}>
              <Pause className="h-4 w-4" />
              Pause
            </Button>
          )}
          <Badge variant="outline">{isPlaying ? 'Playing' : 'Paused'}</Badge>
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium">Volume</label>
          <div className="flex items-center gap-3">
            <Volume2 className="h-4 w-4 text-primary" />
            <Input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={preferences.volume}
              onChange={(event) => {
                updatePreferences({ volume: Number(event.target.value) })
              }}
            />
            <span className="w-10 text-right text-xs text-muted-foreground">
              {Math.round(preferences.volume * 100)}%
            </span>
          </div>
        </div>

        {preferences.selectedSound === 'youtube' ? (
          <div className="space-y-2 rounded-lg border border-border/70 bg-background/70 p-3">
            <p className="text-xs text-muted-foreground">
              Optional lo-fi stream embed (works only while playing).
            </p>
            {isPlaying ? (
              <div className="aspect-video overflow-hidden rounded-lg border border-border/60">
                <iframe
                  src={`${preferences.youtubeUrl}${preferences.youtubeUrl.includes('?') ? '&' : '?'}autoplay=1`}
                  title="Lo-fi focus stream"
                  className="h-full w-full"
                  allow="autoplay; encrypted-media; picture-in-picture"
                  loading="lazy"
                />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Press play to load the stream.</p>
            )}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
