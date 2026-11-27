// Sound is off until the visitor turns it on. Both sounds are recordings in
// public/sounds, fetched the first time sound is switched on:
//
//   cork-pop.mp3   plays as the cork leaves the bottle
//   pour-plop.mp3  plays as the pour first lands in the glass
//
// Replace either file to change the sound.

const FILES = {
  pop: '/sounds/cork-pop.mp3',
  plop: '/sounds/pour-plop.mp3',
}

class Sound {
  constructor() {
    this.enabled = false
    this.context = null
    this.buffers = {}
  }

  toggle() {
    if (this.enabled) {
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

  plop() {
    this.play('plop', 0.8)
  }
}

export const sound = new Sound()
