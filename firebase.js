import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js';
import { getAuth, signInAnonymously } from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js';
import {
  collection,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  getFirestore,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where
} from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js';
import { CONFIG } from './config.js';

const app = initializeApp(CONFIG.firebase);
const auth = getAuth(app);
const db = getFirestore(app);

export async function getTopScores(count = 10) {
  const scores = query(collection(db, 'scores'), orderBy('score', 'desc'), limit(count));
  const snapshot = await getDocs(scores);
  return snapshot.docs.map(entry => ({ id: entry.id, ...entry.data() }));
}

async function getRank(score) {
  try {
    const higher = query(collection(db, 'scores'), where('score', '>', score));
    const snapshot = await getCountFromServer(higher);
    return snapshot.data().count + 1;
  } catch {
    return null;
  }
}

export async function submitScore(name, score) {
  await auth.authStateReady();
  if (!auth.currentUser) await signInAnonymously(auth);

  const uid = auth.currentUser.uid;
  const ref = doc(db, 'scores', uid);
  const existing = await getDoc(ref);
  const best = existing.exists() ? existing.data().score : null;

  if (best !== null && score < best) {
    return { saved: false, best, rank: await getRank(best) };
  }

  const data = {
    uid,
    name: name.trim().slice(0, 16) || 'Player',
    score,
    updatedAt: serverTimestamp()
  };
  if (!existing.exists()) data.createdAt = serverTimestamp();

  await setDoc(ref, data, { merge: true });
  return { saved: true, best: score, rank: await getRank(score) };
}
