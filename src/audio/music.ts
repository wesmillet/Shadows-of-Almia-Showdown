/**
 * Music: one looping track at a time, crossfaded when the situation changes (src/ui/matchScreen.ts picks
 * it). The tracks are in assets/music, each trimmed just past its loop end with the seam pre-blended
 * (scratchpad tooling, see CREDITS.md), so looping from LOOPS[id][1] back to LOOPS[id][0] is seamless.
 *
 * Browsers only allow sound after the player has clicked or pressed a key, so nothing plays (and no
 * AudioContext exists) until then. N mutes or unmutes; the choice is kept in this browser.
 */
import { ASSET_ROOT } from '../sprites/assets';
import { onSettings, settings } from '../settings';

export type TrackId = 'abyss' | 'trainer' | 'shadow_lugia' | 'mewtwo' | 'darkrai';

/** [loopStart, loopEnd] in seconds within each file. */
const LOOPS: Record<TrackId, [number, number]> = {
  abyss: [6.0, 42.0],
  trainer: [5.7143, 68.5714],
  shadow_lugia: [6.9565, 69.5652],
  mewtwo: [6.4, 64.0],
  darkrai: [16.5517, 49.6552],
};

/** How loud each track sits against the others (Abyss is an ambience, so quieter). */
const LEVEL: Record<TrackId, number> = { abyss: 0.7, trainer: 0.55, shadow_lugia: 0.6, mewtwo: 0.55, darkrai: 0.6 };

const MUTE_KEY = 'almia.music.muted';

function loadMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

class MusicPlayer {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private readonly buffers = new Map<TrackId, Promise<AudioBuffer | null>>();
  private playing: { id: TrackId; src: AudioBufferSourceNode; gain: GainNode } | null = null;
  /** What the game wants playing now (it may still be loading, or waiting for a click). */
  private wanted: TrackId | null = null;
  private starting: TrackId | null = null;
  muted = loadMuted();
  volume = settings.music;

  constructor() {
    if (typeof window === 'undefined') return;
    const unlock = (): void => {
      this.unlock();
      if (this.ctx?.state === 'running') {
        window.removeEventListener('pointerdown', unlock);
        window.removeEventListener('keydown', unlock);
      }
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  /** Creates (or resumes) the audio context; must happen inside a click or key press. */
  private unlock(): void {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    if (!this.ctx) {
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    this.apply();
  }

  private load(id: TrackId): Promise<AudioBuffer | null> {
    let p = this.buffers.get(id);
    if (!p) {
      const ctx = this.ctx as AudioContext;
      p = fetch(`${ASSET_ROOT}music/${id}.mp3`)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
        .then((b) => ctx.decodeAudioData(b))
        .catch(() => null);
      this.buffers.set(id, p);
    }
    return p;
  }

  /** The track for right now, or null for silence. Cheap to call every frame. */
  want(id: TrackId | null): void {
    if (id === this.wanted) return;
    this.wanted = id;
    this.apply();
  }

  /** Music volume 0..1 (Options). */
  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.ctx && this.master && !this.muted) this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.05);
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    try {
      localStorage.setItem(MUTE_KEY, this.muted ? '1' : '0');
    } catch {
      /* storage blocked: the choice lasts this session */
    }
    if (this.ctx && this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime, 0.1);
    return this.muted;
  }

  private apply(): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const id = this.wanted;
    if (this.playing?.id === id || this.starting === id) return;
    // Fade out whatever is on.
    if (this.playing) {
      const old = this.playing;
      this.playing = null;
      old.gain.gain.cancelScheduledValues(ctx.currentTime);
      old.gain.gain.setValueAtTime(old.gain.gain.value, ctx.currentTime);
      old.gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 1.6);
      old.src.stop(ctx.currentTime + 1.7);
    }
    if (!id) return;
    this.starting = id;
    void this.load(id).then((buf) => {
      if (this.starting === id) this.starting = null;
      if (!buf || this.wanted !== id || this.playing?.id === id || !this.master) return;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const [a, b] = LOOPS[id];
      src.loopStart = a;
      src.loopEnd = Math.min(b, buf.duration);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(LEVEL[id], ctx.currentTime + (id === 'abyss' ? 3 : 1.2));
      src.connect(gain).connect(this.master);
      src.start();
      this.playing = { id, src, gain };
    });
  }
}

export const music = new MusicPlayer();

onSettings(() => music.setVolume(settings.music));
