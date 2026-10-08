import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Check,
  Maximize,
  Minimize,
  Pause,
  PictureInPicture2,
  Play,
  RotateCcw,
  RotateCw,
  Volume1,
  Volume2,
  VolumeX,
} from 'lucide-react';

import { Button } from '@sunstead/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@sunstead/ui/components/dropdown-menu';
import { Slider } from '@sunstead/ui/components/slider';
import { cn } from '@/lib/utils';
import { ViewerToolbar, ViewerToolbarSeparator } from './viewer-toolbar';

/*
 * WKWebView exposes only the `webkit`-prefixed fullscreen API, so the
 * unprefixed call is simply absent and throws. These narrow the DOM types
 * enough to reach the prefixed methods without an `any` in the call sites.
 */
type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};

function currentFullscreenElement(): Element | null {
  const owner = document as FullscreenDocument;
  return owner.fullscreenElement ?? owner.webkitFullscreenElement ?? null;
}

/**
 * Whether fullscreen can be asked for at all. Checked so the button is hidden
 * rather than present and dead -- a control that does nothing is worse than no
 * control.
 */
const FULLSCREEN_SUPPORTED =
  typeof HTMLElement !== 'undefined' &&
  Boolean(
    HTMLElement.prototype.requestFullscreen ??
      (HTMLElement.prototype as FullscreenElement).webkitRequestFullscreen,
  );

const SKIP_SECONDS = 10;
const ARROW_SECONDS = 5;
const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
/** How long the video chrome stays up after the pointer stops moving. */
const CHROME_LINGER_MS = 2500;

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';

  const whole = Math.floor(seconds);
  const s = String(whole % 60).padStart(2, '0');
  const m = Math.floor(whole / 60) % 60;
  const h = Math.floor(whole / 3600);

  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

type MediaPlayerProps = {
  src: string;
  kind: 'video' | 'audio';
  /** Shown above the transport bar in the audio layout. */
  title?: string;
  /** `compact` is the inline-in-a-note layout: one row, no fullscreen or PiP. */
  density?: 'full' | 'compact';
  autoPlay?: boolean;
  className?: string;
  /** Explicit size, which an embed's `|WxH` suffix supplies. */
  style?: React.CSSProperties;
};

/**
 * Audio and video playback with the app's own transport bar.
 *
 * Built on the native element rather than a player library: the browser's
 * media API is small enough that a wrapper would cost more than it saves, and
 * the point of this rework was to stop the *chrome* varying between WKWebView,
 * WebView2 and WebKitGTK -- which only owning it outright achieves.
 *
 * The same component serves the standalone tab and the inline embed, because
 * a player that behaves differently depending on where it is drawn is a second
 * set of bugs.
 */
export function MediaPlayer({
  src,
  kind,
  title,
  density = 'full',
  autoPlay = false,
  className,
  style,
}: MediaPlayerProps) {
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const chromeTimer = useRef<number | null>(null);

  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  const [chromeVisible, setChromeVisible] = useState(true);

  /**
   * The position being dragged, or `null` when not scrubbing. Seeking the
   * element on every pointer move makes playback stutter as the decoder
   * restarts, so the thumb follows local state and the seek lands on release.
   */
  const [scrub, setScrub] = useState<number | null>(null);

  const isVideo = kind === 'video';
  const shown = scrub ?? currentTime;

  useEffect(() => {
    const media = mediaRef.current;
    if (!media) return;

    const syncTime = () => setCurrentTime(media.currentTime);
    const syncDuration = () => setDuration(media.duration || 0);
    const syncVolume = () => {
      setVolume(media.volume);
      setMuted(media.muted);
    };
    const syncBuffered = () => {
      const ranges = media.buffered;
      // Only the range the playhead is actually inside says anything useful
      // about what will play next; the others are ahead of a gap.
      for (let index = 0; index < ranges.length; index += 1) {
        if (ranges.start(index) <= media.currentTime && media.currentTime <= ranges.end(index)) {
          setBuffered(ranges.end(index));
          return;
        }
      }
      setBuffered(ranges.length > 0 ? ranges.end(ranges.length - 1) : 0);
    };

    const listeners: [string, () => void][] = [
      ['timeupdate', syncTime],
      ['seeked', syncTime],
      ['durationchange', syncDuration],
      ['loadedmetadata', syncDuration],
      ['progress', syncBuffered],
      ['volumechange', syncVolume],
      ['ratechange', () => setRate(media.playbackRate)],
      ['play', () => setPlaying(true)],
      ['pause', () => setPlaying(false)],
      ['ended', () => setPlaying(false)],
    ];

    for (const [event, handler] of listeners) media.addEventListener(event, handler);

    syncDuration();
    syncVolume();

    return () => {
      for (const [event, handler] of listeners) media.removeEventListener(event, handler);
    };
  }, [src]);

  useEffect(() => {
    const onChange = () =>
      setFullscreen(currentFullscreenElement() === containerRef.current);

    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('webkitfullscreenchange', onChange);

    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      document.removeEventListener('webkitfullscreenchange', onChange);
    };
  }, []);

  const togglePlay = useCallback(() => {
    const media = mediaRef.current;
    if (!media) return;
    if (media.paused) void media.play().catch(() => undefined);
    else media.pause();
  }, []);

  const seekBy = useCallback((delta: number) => {
    const media = mediaRef.current;
    if (!media) return;
    media.currentTime = Math.min(
      Math.max(media.currentTime + delta, 0),
      media.duration || Number.MAX_SAFE_INTEGER,
    );
  }, []);

  const nudgeVolume = useCallback((delta: number) => {
    const media = mediaRef.current;
    if (!media) return;
    media.volume = Math.min(Math.max(media.volume + delta, 0), 1);
    if (media.volume > 0) media.muted = false;
  }, []);

  const toggleFullscreen = useCallback(() => {
    const owner = document as FullscreenDocument;

    if (currentFullscreenElement()) {
      const exit = owner.exitFullscreen ?? owner.webkitExitFullscreen;
      void Promise.resolve(exit?.call(owner)).catch(() => undefined);
      return;
    }

    const node = containerRef.current as FullscreenElement | null;
    if (!node) return;

    const request = node.requestFullscreen ?? node.webkitRequestFullscreen;
    // Present on the prototype but still refusable by the embedder, so the
    // rejection is swallowed rather than surfaced as an error.
    void Promise.resolve(request?.call(node)).catch(() => undefined);
  }, []);

  /**
   * Kept out of the way while a video is playing, but never unmounted -- a
   * pointer already resting on a button would lose its target mid-click.
   */
  const wakeChrome = useCallback(() => {
    setChromeVisible(true);
    if (chromeTimer.current !== null) window.clearTimeout(chromeTimer.current);
    chromeTimer.current = window.setTimeout(
      () => setChromeVisible(false),
      CHROME_LINGER_MS,
    );
  }, []);

  useEffect(() => {
    if (!isVideo || !playing) {
      if (chromeTimer.current !== null) window.clearTimeout(chromeTimer.current);
      setChromeVisible(true);
      return;
    }
    wakeChrome();
    return () => {
      if (chromeTimer.current !== null) window.clearTimeout(chromeTimer.current);
    };
  }, [isVideo, playing, wakeChrome]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    // Never steal a key from a control the user has tabbed to -- Space on a
    // focused button is that button's, not the player's.
    if ((event.target as HTMLElement).closest('button, input, [role="menu"]')) return;

    switch (event.key) {
      case ' ':
      case 'k':
        togglePlay();
        break;
      case 'ArrowLeft':
        seekBy(-ARROW_SECONDS);
        break;
      case 'ArrowRight':
        seekBy(ARROW_SECONDS);
        break;
      case 'ArrowUp':
        nudgeVolume(0.1);
        break;
      case 'ArrowDown':
        nudgeVolume(-0.1);
        break;
      case 'm':
        if (mediaRef.current) mediaRef.current.muted = !mediaRef.current.muted;
        break;
      case 'f':
        if (isVideo && FULLSCREEN_SUPPORTED) toggleFullscreen();
        break;
      default:
        return;
    }

    event.preventDefault();
    if (isVideo) wakeChrome();
  };

  const VolumeIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  const compact = density === 'compact';

  const transport = (
    <ViewerToolbar
      className={cn('solstice-media-chrome', compact && 'w-full')}
      data-hidden={isVideo && !chromeVisible ? 'true' : undefined}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <Button
        size='icon-sm'
        variant='ghost'
        title={playing ? 'Pause (space)' : 'Play (space)'}
        aria-label={playing ? 'Pause' : 'Play'}
        onClick={togglePlay}
      >
        {playing ? <Pause /> : <Play />}
      </Button>

      {!compact && (
        <>
          <Button
            size='icon-sm'
            variant='ghost'
            title={`Back ${SKIP_SECONDS}s`}
            aria-label={`Back ${SKIP_SECONDS} seconds`}
            onClick={() => seekBy(-SKIP_SECONDS)}
          >
            <RotateCcw />
          </Button>
          <Button
            size='icon-sm'
            variant='ghost'
            title={`Forward ${SKIP_SECONDS}s`}
            aria-label={`Forward ${SKIP_SECONDS} seconds`}
            onClick={() => seekBy(SKIP_SECONDS)}
          >
            <RotateCw />
          </Button>
        </>
      )}

      {/*
        Three layers: the unplayed track, how far the file has actually
        downloaded, then the real slider with a transparent track of its own.
        The buffered bar cannot live inside the shadcn slider, which owns its
        internals, so it is drawn behind it at the same geometry.
      */}
      <div className={cn('relative mx-2 flex items-center', compact ? 'flex-1' : 'w-64')}>
        <div className='pointer-events-none absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-input' />
        <div
          className='solstice-media-buffered top-1/2 h-1 -translate-y-1/2 rounded-full'
          style={{ width: duration > 0 ? `${(buffered / duration) * 100}%` : '0%' }}
        />
        <Slider
          className='relative [&_[data-slot=slider-track]]:bg-transparent'
          aria-label='Seek'
          value={shown}
          min={0}
          max={duration || 1}
          step={0.01}
          onValueChange={(next) => setScrub(next as number)}
          onValueCommitted={(next) => {
            if (mediaRef.current) mediaRef.current.currentTime = next as number;
            setScrub(null);
          }}
        />
      </div>

      <span className='shrink-0 px-1 text-xs tabular-nums text-muted-foreground select-none'>
        {formatTime(shown)} / {formatTime(duration)}
      </span>

      <ViewerToolbarSeparator />

      <div className='flex items-center'>
        <Button
          size='icon-sm'
          variant='ghost'
          title={muted ? 'Unmute (m)' : 'Mute (m)'}
          aria-label={muted ? 'Unmute' : 'Mute'}
          onClick={() => {
            if (mediaRef.current) mediaRef.current.muted = !mediaRef.current.muted;
          }}
        >
          <VolumeIcon />
        </Button>
        {/*
          Always shown, and never inside an `overflow-hidden` box. It used to
          expand on hover, which clipped the thumb: the thumb is centred on its
          value, so at 0 and 1 it hangs half outside the track. `px-2` is that
          overhang, reserved so the handle is whole at both ends.

          Dropped entirely in the compact layout instead of collapsed -- an
          inline player has no room for it, and a control that has to be
          discovered by hovering is worse than one that is simply absent.
        */}
        {!compact && (
          <Slider
            className='w-20 px-2'
            aria-label='Volume'
            value={muted ? 0 : volume}
            min={0}
            max={1}
            step={0.01}
            onValueChange={(next) => {
              if (!mediaRef.current) return;
              mediaRef.current.volume = next as number;
              mediaRef.current.muted = (next as number) === 0;
            }}
          />
        )}
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              size='xs'
              variant='ghost'
              title='Playback speed'
              className='w-11 tabular-nums'
            >
              {rate}&times;
            </Button>
          }
        />
        <DropdownMenuContent align='end' className='min-w-24'>
          {RATES.map((option) => (
            <DropdownMenuItem
              key={option}
              onClick={() => {
                if (mediaRef.current) mediaRef.current.playbackRate = option;
              }}
            >
              <span className='tabular-nums'>{option}&times;</span>
              {rate === option && <Check className='ml-auto size-3.5' />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {isVideo && !compact && (
        <>
          {document.pictureInPictureEnabled && (
            <Button
              size='icon-sm'
              variant='ghost'
              title='Picture in picture'
              aria-label='Picture in picture'
              onClick={() => {
                const video = mediaRef.current;
                if (video instanceof HTMLVideoElement) {
                  void video.requestPictureInPicture().catch(() => undefined);
                }
              }}
            >
              <PictureInPicture2 />
            </Button>
          )}
          {FULLSCREEN_SUPPORTED && (
          <Button
            size='icon-sm'
            variant='ghost'
            title={fullscreen ? 'Exit fullscreen (f)' : 'Fullscreen (f)'}
            aria-label='Toggle fullscreen'
            onClick={toggleFullscreen}
          >
            {fullscreen ? <Minimize /> : <Maximize />}
          </Button>
          )}
        </>
      )}
    </ViewerToolbar>
  );

  if (!isVideo) {
    return (
      <div
        ref={containerRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        style={style}
        className={cn('flex flex-col items-stretch gap-2 outline-none', className)}
      >
        <audio ref={mediaRef} src={src} autoPlay={autoPlay} preload='metadata' />
        {title && (
          <p className='truncate px-1 text-sm font-medium text-foreground'>{title}</p>
        )}
        {transport}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerMove={playing ? wakeChrome : undefined}
      style={style}
      className={cn(
        'relative flex items-center justify-center overflow-hidden bg-background outline-none',
        // Padding rather than a margin on the video: the toolbar is positioned
        // against the padding box, so it lands in this gutter instead of over
        // the picture.
        density === 'full' && 'p-8',
        className,
      )}
    >
      <video
        ref={mediaRef as React.RefObject<HTMLVideoElement>}
        src={src}
        autoPlay={autoPlay}
        preload='metadata'
        className='max-h-full max-w-full'
        onClick={togglePlay}
      />
      <div className='pointer-events-none absolute inset-x-0 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-10 flex justify-center px-3'>
        {transport}
      </div>
    </div>
  );
}
