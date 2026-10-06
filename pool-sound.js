// Neon 8-Ball sound effects, synthesised with Web Audio so there are no files to load.
window.NeonPoolSound = (() => {
  let audio = null, noise = null, muted = false;
  try { muted = localStorage.neonPoolMuted === '1'; } catch {}

  // Browsers only allow audio after a user gesture, so the context is created on first use.
  function context() {
    if (muted) return null;
    if (!audio) {
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context) return null;
      audio = new Context();
      noise = audio.createBuffer(1, audio.sampleRate * .2, audio.sampleRate);
      const data = noise.getChannelData(0);
      for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    }
    if (audio.state === 'suspended') audio.resume();
    return audio;
  }

  function tone({ frequency, type = 'sine', volume, duration, slide = 0, delay = 0 }) {
    const ctx = context(); if (!ctx) return;
    const start = ctx.currentTime + delay, oscillator = ctx.createOscillator(), gain = ctx.createGain();
    oscillator.type = type; oscillator.frequency.setValueAtTime(frequency, start);
    if (slide) oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, frequency + slide), start + duration);
    gain.gain.setValueAtTime(volume, start); gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
    oscillator.connect(gain).connect(ctx.destination); oscillator.start(start); oscillator.stop(start + duration + .02);
  }
  function burst({ frequency, q = 6, volume, duration, delay = 0 }) {
    const ctx = context(); if (!ctx) return;
    const start = ctx.currentTime + delay, source = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), gain = ctx.createGain();
    source.buffer = noise; filter.type = 'bandpass'; filter.frequency.value = frequency; filter.Q.value = q;
    gain.gain.setValueAtTime(volume, start); gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
    source.connect(filter).connect(gain).connect(ctx.destination); source.start(start); source.stop(start + duration + .02);
  }
  const level = (speed, full) => Math.max(.02, Math.min(1, speed / full));

  return {
    get muted() { return muted; },
    setMuted(value) { muted = value; try { localStorage.neonPoolMuted = value ? '1' : '0'; } catch {} if (muted && audio) audio.suspend(); },
    unlock() { context(); },
    cue(power) { burst({ frequency: 2400, q: 3, volume: .25 + power * .35, duration: .05 }); tone({ frequency: 180, volume: .15 * power, duration: .08 }); },
    click(speed) { const v = level(speed, 1100); burst({ frequency: 3200 + v * 900, q: 9, volume: .5 * v, duration: .035 }); },
    rail(speed) { const v = level(speed, 1200); tone({ frequency: 95, volume: .35 * v, duration: .12, slide: -30 }); burst({ frequency: 600, q: 2, volume: .12 * v, duration: .06 }); },
    pocket() { tone({ frequency: 140, volume: .4, duration: .18, slide: -70 }); burst({ frequency: 900, q: 4, volume: .18, duration: .12, delay: .05 }); burst({ frequency: 700, q: 4, volume: .12, duration: .1, delay: .14 }); },
    turn() { tone({ frequency: 660, type: 'triangle', volume: .18, duration: .14 }); tone({ frequency: 990, type: 'triangle', volume: .16, duration: .2, delay: .12 }); },
    foul() { tone({ frequency: 220, type: 'square', volume: .08, duration: .22, slide: -80 }); },
    win() { [523, 659, 784, 1047].forEach((frequency, i) => tone({ frequency, type: 'triangle', volume: .16, duration: .28, delay: i * .11 })); },
    lose() { [392, 330, 262].forEach((frequency, i) => tone({ frequency, type: 'triangle', volume: .14, duration: .3, delay: i * .14 })); },
  };
})();
