// Sound is off until the visitor turns it on, and it is all synthesized here.
// There are no audio files. The pour is filtered noise whose pitch climbs as
// the glass fills, the way a real pour does. The cork is a short thump.

class Sound {
  constructor() {
    this.enabled = false
    this.context = null
  }

  toggle() {
    if (this.enabled) {
      this.enabled = false
      this.master?.gain.setTargetAtTime(0, this.context.currentTime, 0.05)
      return false
    }
    if (!this.context) this.build()
    this.context.resume()
    this.enabled = true
    this.master.gain.setTargetAtTime(1, this.context.currentTime, 0.05)
    return true
  }

  build() {
    const Context = window.AudioContext || window.webkitAudioContext
    const context = (this.context = new Context())
    this.master = context.createGain()
    this.master.gain.value = 0
    this.master.connect(context.destination)

    // Two seconds of noise, looped, is the raw material for both sounds.
    const buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
    this.noise = buffer

    const source = context.createBufferSource()
    source.buffer = buffer
    source.loop = true
    this.pourFilter = context.createBiquadFilter()
    this.pourFilter.type = 'bandpass'
    this.pourFilter.Q.value = 1.1
    const highpass = context.createBiquadFilter()
    highpass.type = 'highpass'
    highpass.frequency.value = 350
    this.pourGain = context.createGain()
    this.pourGain.gain.value = 0

    // A slow flutter so the pour gurgles instead of hissing.
    const flutter = context.createOscillator()
    flutter.frequency.value = 11
    const flutterDepth = context.createGain()
    flutterDepth.gain.value = 0.25
    const flutterGain = context.createGain()
    flutterGain.gain.value = 0.75
    flutter.connect(flutterDepth).connect(flutterGain.gain)

    source.connect(this.pourFilter).connect(highpass).connect(flutterGain).connect(this.pourGain).connect(this.master)
    source.start()
    flutter.start()
  }

  // amount: 0 to 1, how much is pouring. fill: 0 to 1, how full the glass is.
  setPour(amount, fill) {
    if (!this.enabled) return
    const now = this.context.currentTime
    this.pourGain.gain.setTargetAtTime(amount * 0.22, now, 0.06)
    this.pourFilter.frequency.setTargetAtTime(700 + fill * 1900, now, 0.1)
  }

  pop() {
    if (!this.enabled) return
    const context = this.context
    const now = context.currentTime

    const thump = context.createOscillator()
    thump.frequency.setValueAtTime(420, now)
    thump.frequency.exponentialRampToValueAtTime(90, now + 0.11)
    const thumpGain = context.createGain()
    thumpGain.gain.setValueAtTime(0.6, now)
    thumpGain.gain.exponentialRampToValueAtTime(0.001, now + 0.22)
    thump.connect(thumpGain).connect(this.master)
    thump.start(now)
    thump.stop(now + 0.25)

    const click = context.createBufferSource()
    click.buffer = this.noise
    const clickFilter = context.createBiquadFilter()
    clickFilter.type = 'bandpass'
    clickFilter.frequency.value = 1800
    const clickGain = context.createGain()
    clickGain.gain.setValueAtTime(0.5, now)
    clickGain.gain.exponentialRampToValueAtTime(0.001, now + 0.05)
    click.connect(clickFilter).connect(clickGain).connect(this.master)
    click.start(now)
    click.stop(now + 0.06)
  }
}

export const sound = new Sound()
