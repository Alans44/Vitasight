export function playAlertSound(context: AudioContext, fall: boolean) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = fall ? "triangle" : "sine";
  oscillator.connect(gain);
  gain.connect(context.destination);
  const start = context.currentTime;
  gain.gain.setValueAtTime(0, start);
  const tones = fall ? [880, 660, 880] : [620];
  tones.forEach((frequency, index) => {
    const at = start + index * 0.35;
    oscillator.frequency.setValueAtTime(frequency, at);
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(fall ? 0.16 : 0.06, at + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, at + 0.24);
    gain.gain.linearRampToValueAtTime(0, at + 0.27);
  });
  oscillator.addEventListener(
    "ended",
    () => {
      oscillator.disconnect();
      gain.disconnect();
    },
    { once: true },
  );
  oscillator.start(start);
  oscillator.stop(start + tones.length * 0.35);
  return oscillator;
}
