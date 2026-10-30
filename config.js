export const CONFIG = {
  duration: 60,

  firebase: {
    apiKey: 'AIzaSyCdbK0OqFeUTRlUJyng-6KWvBMPIUleL7Q',
    authDomain: 'yn-fruitninja-db.firebaseapp.com',
    projectId: 'yn-fruitninja-db',
    storageBucket: 'yn-fruitninja-db.firebasestorage.app',
    messagingSenderId: '37244823311',
    appId: '1:37244823311:web:21d3a7efd3cd35394c807a'
  },

  points: {
    fruit: 6,
    high: 12,
    bomb: -9
  },

  combo: {
    max: 5,
    slicesPerTier: 10,
    graceMs: 1000,
    decayMs: 4000
  },

  feedback: {
    juiceParticles: 9,
    bombParticles: 16,
    particleLife: 0.65,
    popupLife: 0.75,
    shakeTime: 0.3,
    shakeAmount: 0.02
  },

  spawn: {
    bombAfterSeconds: 50,
    bombChance: 0.18,
    bombMaxPerWave: 2,
    highChance: 0.1,
    wave2At: 50,
    wave3At: 25,
    wave4At: 15,
    startDelay: 0.8,
    intervalMin: 0.6,
    intervalMax: 0.9
  },

  physics: {
    radius: 0.08,
    gravity: 1.5,
    apexMin: 0.5,
    apexRange: 0.35,
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
