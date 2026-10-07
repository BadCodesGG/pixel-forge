/**
 * AUDIO: synthesised, no files.
 *
 * Every sound is generated from oscillators and envelopes at runtime. No
 * samples, which means no megabytes to download, no licence to audit, and
 * nothing that could be mistaken for someone else's audio.
 *
 * ---------------------------------------------------------------------------
 * THE AUTOPLAY RULE
 * ---------------------------------------------------------------------------
 * A browser will not let audio start without a user gesture. An AudioContext
 * created before one exists is born "suspended" and stays silent, which
 * presents as "the game has no sound" rather than as an error, so it is easy
 * to ship broken. The context is therefore created lazily inside the first
 * real interaction, and `resume()` is retried whenever the tab comes back.
 */

type Ctx = AudioContext;

/** A note in equal temperament. A4 = 440Hz, so this is the standard formula. */
function note(semitonesFromA4: number): number {
  return 440 * Math.pow(2, semitonesFromA4 / 12);
}

const NOTE = {
  C4: note(-9),
  E4: note(-5),
  G4: note(-2),
  A4: note(0),
  C5: note(3),
  E5: note(7),
  G5: note(10),
  C6: note(15),
} as const;

export class Audio {
  private ctx: Ctx | null = null;
  private master: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;

  private musicTimer = 0;
  private musicStep = 0;
  private musicPlaying = false;
  /** Raised when the level timer is running out. */
  private tempoScale = 1;

  muted = false;

  /**
   * Create or resume the context. MUST be called from inside a user gesture.
   *
   * Safe to call repeatedly: after the first time it is just a resume, which
   * is what recovers audio after the tab has been backgrounded.
   */
  unlock(): void {
    if (!this.ctx) {
      const Constructor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Constructor) return;
      this.ctx = new Constructor();

      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);

      // Separate buses so music and effects can be balanced (and later muted)
      // independently, which is one node each rather than a search-and-replace.
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.22;
      this.musicGain.connect(this.master);

      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = 0.7;
      this.sfxGain.connect(this.master);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  get ready(): boolean {
    return this.ctx !== null && this.ctx.state === "running";
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : 0.5;
  }

  /**
   * One synthesised tone.
   *
   * The envelope is the whole character of the sound: an instant attack and a
   * fast exponential decay is what makes something read as a "blip" rather
   * than a "beep". `exponentialRampToValueAtTime` cannot reach zero, hence the
   * tiny floor value.
   */
  private tone(
    freq: number,
    duration: number,
    type: OscillatorType = "square",
    gain = 0.3,
    sweepTo?: number,
    delay = 0,
  ): void {
    const ctx = this.ctx;
    const bus = this.sfxGain;
    if (!ctx || !bus || this.muted) return;

    const start = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (sweepTo !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, sweepTo), start + duration);
    }

    env.gain.setValueAtTime(gain, start);
    env.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    osc.connect(env);
    env.connect(bus);
    osc.start(start);
    // One-shot nodes are garbage collected once stopped, so nothing to clean up.
    osc.stop(start + duration + 0.02);
  }

  /** Short noise burst, for impacts. */
  private noise(duration: number, gain = 0.25, delay = 0): void {
    const ctx = this.ctx;
    const bus = this.sfxGain;
    if (!ctx || !bus || this.muted) return;

    const frames = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) {
      // Fade the noise across its own length so it lands as a thud, not a click.
      data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
    }
    const src = ctx.createBufferSource();
    const env = ctx.createGain();
    src.buffer = buffer;
    env.gain.value = gain;
    src.connect(env);
    env.connect(bus);
    src.start(ctx.currentTime + delay);
  }

  // -------------------------------------------------------------------------
  // The sound set
  // -------------------------------------------------------------------------

  jump(): void {
    // Rising sweep: the pitch going UP is what makes it read as leaving the
    // ground, independent of how it is voiced.
    this.tone(NOTE.C4, 0.16, "square", 0.28, NOTE.C5);
  }

  coin(): void {
    // Two-note flourish, the universal "you got something" shape.
    this.tone(NOTE.E5, 0.07, "square", 0.24);
    this.tone(NOTE.G5, 0.16, "square", 0.24, undefined, 0.06);
  }

  stomp(): void {
    this.noise(0.09, 0.3);
    this.tone(NOTE.C5, 0.1, "square", 0.2, NOTE.C4);
  }

  bump(): void {
    this.tone(NOTE.C4, 0.06, "square", 0.18, note(-21));
  }

  grow(): void {
    // Ascending arpeggio: unmistakably a reward, and clearly different from
    // the coin, which matters when both can fire in the same second.
    const seq = [NOTE.C4, NOTE.E4, NOTE.G4, NOTE.C5, NOTE.E5, NOTE.G5];
    seq.forEach((f, i) => this.tone(f, 0.1, "square", 0.22, undefined, i * 0.05));
  }

  hurt(): void {
    this.tone(NOTE.G4, 0.28, "sawtooth", 0.26, note(-24));
    this.noise(0.12, 0.2);
  }

  die(): void {
    // Long downward slide. Falling pitch reads as failure everywhere.
    this.tone(NOTE.C5, 0.9, "square", 0.3, note(-33));
  }

  win(): void {
    const seq = [NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6];
    seq.forEach((f, i) => this.tone(f, 0.22, "square", 0.3, undefined, i * 0.13));
  }

  /**
   * The extra life.
   *
   * Deliberately the most distinctive sound in the game: two rising thirds and
   * a held note, so it cannot be confused with a coin or a power gem even when
   * all three happen within a second of each other.
   */
  oneUp(): void {
    // Semitones above the table's base, since the table stops at C6.
    const seq = [NOTE.E5, NOTE.G5, note(19), NOTE.C6, note(17), note(22)];
    seq.forEach((f, i) => this.tone(f, 0.12, "square", 0.26, undefined, i * 0.07));
  }

  // -------------------------------------------------------------------------
  // Interface sounds
  //
  // A game menu is audible; a web form is not. These are deliberately quiet and
  // very short - they fire on every press, so anything with a tail becomes
  // irritating within a minute of building a level.
  // -------------------------------------------------------------------------

  /** Going into a warp pipe. A descending swallow, then nothing. */
  pipe(): void {
    this.tone(NOTE.C5, 0.22, "square", 0.24, note(-14));
    this.noise(0.14, 0.16, 0.04);
  }

  /** Any ordinary press. */
  click(): void {
    this.tone(NOTE.A4, 0.04, "square", 0.12);
  }

  /** Picking a tool or a part. A fifth above the click, so choosing sounds
   *  like a decision rather than a repeat of the same tap. */
  select(): void {
    this.tone(NOTE.E5, 0.05, "square", 0.14);
  }

  /** A press that could not do anything: undo with nothing to undo. A short
   *  downward blip, so "nothing happened" is heard and not just seen. */
  deny(): void {
    this.tone(NOTE.A4, 0.07, "square", 0.1, note(-14));
  }

  // -------------------------------------------------------------------------
  // Music
  // -------------------------------------------------------------------------

  /**
   * A looping bass-and-lead pattern.
   *
   * Driven from setInterval rather than scheduled far ahead: at this tempo the
   * timing slop is inaudible, and it keeps the whole music system to a few
   * lines. If it ever needs to be tight, the fix is a lookahead scheduler
   * against ctx.currentTime, not a rewrite.
   */
  private static readonly BASS = [NOTE.C4, NOTE.C4, NOTE.G4, NOTE.C4, NOTE.E4, NOTE.C4, NOTE.G4, NOTE.E4];
  private static readonly LEAD = [NOTE.C5, 0, NOTE.E5, NOTE.G5, 0, NOTE.E5, NOTE.C5, 0];

  startMusic(): void {
    if (this.musicPlaying || !this.ctx) return;
    this.musicPlaying = true;
    this.musicStep = 0;
    const tick = () => {
      if (!this.musicPlaying) return;
      this.playMusicStep();
      this.musicTimer = window.setTimeout(tick, 220 / this.tempoScale);
    };
    tick();
  }

  stopMusic(): void {
    this.musicPlaying = false;
    window.clearTimeout(this.musicTimer);
    this.tempoScale = 1;
  }

  /** Speed the music up when the clock is running out. */
  setUrgent(urgent: boolean): void {
    this.tempoScale = urgent ? 1.35 : 1;
  }

  private playMusicStep(): void {
    const ctx = this.ctx;
    const bus = this.musicGain;
    if (!ctx || !bus || this.muted) return;

    const step = this.musicStep % 8;
    this.musicStep += 1;

    const voice = (freq: number, dur: number, type: OscillatorType, gain: number) => {
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      env.gain.setValueAtTime(gain, ctx.currentTime);
      env.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
      osc.connect(env);
      env.connect(bus);
      osc.start();
      osc.stop(ctx.currentTime + dur + 0.02);
    };

    voice(Audio.BASS[step] / 2, 0.2, "triangle", 0.5);
    const lead = Audio.LEAD[step];
    if (lead) voice(lead, 0.16, "square", 0.22);
  }
}

export const audio = new Audio();
