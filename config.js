window.CONFIG = {
  duration: 60,

  points: {
    fruit: 6,
    high: 12,
    bomb: -9
  },

  combo: {
    windowMs: 400
  },

  spawn: {
    bombAfterSeconds: 50,
    bombChance: 0.18,
    highChance: 0.1,
    wave2At: 50,
    wave3At: 25,
    intervalMin: 0.45,
    intervalMax: 0.7
  },

  physics: {
    radius: 0.08,
    gravity: 1.5,
    launchMin: 0.9,
    launchRandom: 0.7,
    drift: 0.44,
    spin: 2,
    separationSpeed: 0.35,
    separationRandom: 0.15,
    separationSpin: 4
  },

  sword: {
    sensitivity: 0.6,
    maxStep: 0.1
  },

  assets: {
    spriteMaxSize: 256,
    sprites: {
      fruit: 'assets/images/medpoint.png',
      high: 'assets/images/highpoint.png',
      bomb: 'assets/images/minuspoint.png'
    },
    slashAudio: [
      'assets/mp3/cut-through-the-air.mp3',
      'assets/mp3/slashed-with-a-sword-and-gushing-blood.mp3',
      'assets/mp3/strong-swing-and-cut-in-half.mp3'
    ],
    explosionAudio: 'assets/mp3/explosion.mp3'
  }
};
