"use strict";

(() => {
  let enabled = localStorage.getItem("make10Audio") !== "off";
  let musicVolume = Math.max(
    0,
    Math.min(
      1,
      Number.parseFloat(localStorage.getItem("make10MusicVolume") ?? "1") || 0
    )
  );
  let ctx = null;
  let master = null;
  let music = null;
  let sfx = null;
  let scheduler = null;
  let nextTime = 0;
  let step = 0;
  let themeIndex = 0;
  let barsInTheme = 0;
  let gameHasStarted = false;

  const themes = [
    { bpm: 62, roots: [48,45,50,43], chord: [0,7,12,16], melody: [12,16,19,16,12,19,16,14] },
    { bpm: 56, roots: [50,47,43,45], chord: [0,5,9,12],  melody: [12,14,17,14,12,17,19,17] },
    { bpm: 66, roots: [45,52,48,50], chord: [0,7,10,14], melody: [12,19,17,14,12,14,17,19] }
  ];

  function hz(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  function ensure() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;

    ctx = new AC();
    master = ctx.createGain();
    music = ctx.createGain();
    sfx = ctx.createGain();

    master.gain.value = enabled ? 0.82 : 0.0001;
    music.gain.value = 0.17 * musicVolume;
    sfx.gain.value = 0.55;

    music.connect(master);
    sfx.connect(master);
    master.connect(ctx.destination);
  }

  async function resume() {
    ensure();
    if (ctx && ctx.state === "suspended") {
      try { await ctx.resume(); } catch (_) {}
    }
  }

  function tone(freq, start, duration, gain, type, destination) {
    if (!enabled || !ctx || !destination) return;

    const osc = ctx.createOscillator();
    const amp = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);

    amp.gain.setValueAtTime(0.0001, start);
    amp.gain.exponentialRampToValueAtTime(Math.max(gain, 0.0002), start + 0.03);
    amp.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    osc.connect(amp);
    amp.connect(destination);
    osc.start(start);
    osc.stop(start + duration + 0.04);
  }

  function musicStep(at) {
    if (!enabled || !ctx) return;

    const theme = themes[themeIndex];
    const beat = 60 / theme.bpm;
    const withinBar = step % 8;
    const bar = Math.floor(step / 8) % 4;
    const root = theme.roots[bar];

    if (withinBar === 0) {
      theme.chord.forEach(interval => {
        tone(hz(root + interval), at, beat * 3.7, 0.012, "sine", music);
        tone(hz(root + interval + 12), at + 0.01, beat * 3.4, 0.0035, "triangle", music);
      });

      barsInTheme++;
      if (barsInTheme >= 8) {
        barsInTheme = 0;
        themeIndex = (themeIndex + 1) % themes.length;
      }
    }

    if (withinBar % 2 === 0) {
      const note = root + theme.melody[withinBar];
      tone(hz(note), at, beat * 1.25, 0.018, "sine", music);
      tone(hz(note + 12), at + 0.012, beat * 0.72, 0.0035, "triangle", music);
    }
  }

  function schedule() {
    if (!enabled || !ctx) return;
    const beat = 60 / themes[themeIndex].bpm;
    const stepLength = beat / 2;

    while (nextTime < ctx.currentTime + 0.18) {
      musicStep(nextTime);
      nextTime += stepLength;
      step++;
    }
  }

  function startMusic() {
    if (!enabled) return;
    ensure();
    if (!ctx || scheduler !== null) return;

    nextTime = ctx.currentTime + 0.06;
    step = 0;
    scheduler = window.setInterval(schedule, 70);
    schedule();
  }

  function click(kind = "button") {
    if (!enabled) return;
    ensure();
    if (!ctx || !sfx) return;

    const now = ctx.currentTime;

    if (kind === "tile") {
      tone(205, now, 0.055, 0.050, "triangle", sfx);
      tone(325, now + 0.011, 0.040, 0.022, "sine", sfx);
    } else {
      tone(500, now, 0.045, 0.032, "triangle", sfx);
    }
  }

  function success() {
    if (!enabled) return;
    ensure();
    if (!ctx || !sfx) return;

    const now = ctx.currentTime;
    [60,64,67,72].forEach((note, i) => {
      tone(hz(note), now + i * 0.075, 0.42, 0.033, "sine", sfx);
    });
  }

  function setMusicVolume(value) {
    musicVolume = Math.max(0, Math.min(1, Number(value) || 0));
    localStorage.setItem("make10MusicVolume", String(musicVolume));

    ensure();

    if (music && ctx) {
      const now = ctx.currentTime;
      music.gain.cancelScheduledValues(now);
      music.gain.setTargetAtTime(0.17 * musicVolume, now, 0.03);
    }
  }

  function getMusicVolume() {
    return musicVolume;
  }

  function updateButtons() {
    const icon = enabled ? "🔊" : "🔇";
    ["menuSoundBtn", "gameSoundBtn"].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.textContent = icon;
        el.setAttribute("aria-label", enabled ? "Mute sound" : "Enable sound");
      }
    });
  }

  async function setEnabled(value) {
    enabled = value;
    localStorage.setItem("make10Audio", enabled ? "on" : "off");
    ensure();

    if (master && ctx) {
      const now = ctx.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setTargetAtTime(enabled ? 0.82 : 0.0001, now, 0.025);
    }

    updateButtons();

    if (enabled) {
      await resume();
      if (gameHasStarted) startMusic();
    }
  }

  document.addEventListener("click", async event => {
    const button = event.target.closest("button");
    if (!button) return;

    await resume();

    if (button.id === "menuSoundBtn" || button.id === "gameSoundBtn") {
      await setEnabled(!enabled);
      return;
    }

    if (button.id === "startGameBtn" || button.id === "howStartBtn") {
      gameHasStarted = true;
      if (enabled) startMusic();
    }

    if (button.classList.contains("number-tile") || button.classList.contains("operator")) {
      click("tile");
    } else {
      click("button");
    }
  });

  document.addEventListener("click", async event => {
    const token = event.target.closest(".expression-token");
    if (!token) return;
    await resume();
    click("tile");
  });

  updateButtons();

  window.Make10Audio = {
    resume,
    startMusic,
    playClick: click,
    playSuccess: success,
    isEnabled: () => enabled,
    setEnabled,
    setMusicVolume,
    getMusicVolume
  };
})();
