// Sound is off until the visitor turns it on. Both sounds are recordings in
// public/sounds, fetched the first time sound is switched on:
//
//   cork-pop.mp3  plays as the cork leaves the bottle
//   pour.mp3      plays while the whiskey is pouring
//
// Replace either file to change the sound.

// The pour lasts as long as the visitor takes to scroll through it, which can
// be longer than the recording. So the recording starts from its beginning,
// and if it reaches this stretch of steady pouring it repeats that stretch
// until the pour stops. Times are in seconds from the start of the file.
const POUR_LOOP = { start: 0.55, end: 1.95 }

const FILES = {
  pop: '/sounds/cork-pop.mp3',
  pour: '/sounds/pour.mp3',
}

class Sound {
  constructor() {
    this.enabled = false
    this.context = null
    this.buffers = {}
    this.pouring = null
  }

  toggle() {
    if (this.enabled) {
      this.stopPour()
      this.enabled = false
      this.master.gain.setTargetAtTime(0, this.context.currentTime, 0.05)
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

    for (const [name, url] of Object.entries(FILES)) {
      fetch(url)
        .then((response) => response.arrayBuffer())
        .then((data) => context.decodeAudioData(data))
        .then((decoded) => (this.buffers[name] = decoded))
        .catch(() => {})
    }
  }

  play(name, volume = 0.9) {
    if (!this.enabled || !this.buffers[name]) return
    const source = this.context.createBufferSource()
    source.buffer = this.buffers[name]
    const gain = this.context.createGain()
    gain.gain.value = volume
    source.connect(gain).connect(this.master)
    source.start()
  }

  pop() {
    this.play('pop')
  }

  startPour() {
    if (!this.enabled || !this.buffers.pour || this.pouring) return
    const source = this.context.createBufferSource()
    source.buffer = this.buffers.pour
    source.loop = true
    source.loopStart = POUR_LOOP.start
    source.loopEnd = POUR_LOOP.end
    const gain = this.context.createGain()
    gain.gain.value = 0.8
    source.connect(gain).connect(this.master)
    source.start()
    this.pouring = { source, gain }
  }

  // Fades out quickly instead of cutting off, so it ends like a pour does.
  stopPour() {
    if (!this.pouring) return
    const { source, gain } = this.pouring
    const now = this.context.currentTime
    gain.gain.setTargetAtTime(0, now, 0.09)
    source.stop(now + 0.5)
    this.pouring = null
  }
}

export const sound = new Sound()
