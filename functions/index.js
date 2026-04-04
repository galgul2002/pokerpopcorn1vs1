const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { initializeApp }      = require("firebase-admin/app");
const { getDatabase }        = require("firebase-admin/database");

initializeApp();

// ── dealCards ────────────────────────────────────────────────────────────────
// Called by the host's browser instead of shuffling locally.
// Runs on Google's servers — neither player can see or influence the shuffle.
//
// What it does:
//   1. Verifies the caller is the actual host of that room
//   2. Shuffles a fresh deck
//   3. Deals starting cards to both grids
//   4. Writes the result to Firebase — both players receive it simultaneously

exports.dealCards = onCall(async (request) => {

  // ── 1. Who is calling? ──────────────────────────────────────────────────
  // request.auth is set automatically by Firebase when the client calls this.
  // If someone tries to call this without being signed in, we reject them.
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "You must be signed in.");
  }
  const callerUID = request.auth.uid;

  // ── 2. Check they're the host of this room ──────────────────────────────
  const { roomCode } = request.data;
  if (!roomCode || typeof roomCode !== "string" || roomCode.length !== 4) {
    throw new HttpsError("invalid-argument", "Invalid room code.");
  }

  const db       = getDatabase();
  const roomSnap = await db.ref(`rooms/${roomCode}`).get();

  if (!roomSnap.exists()) {
    throw new HttpsError("not-found", "Room does not exist.");
  }

  const room = roomSnap.val();

  if (room.hostUID !== callerUID) {
    throw new HttpsError("permission-denied", "Only the host can deal cards.");
  }

  // ── 3. Build and shuffle a fresh 52-card deck ───────────────────────────
  const suits = [
    { s: "♥", c: "red"   },
    { s: "♦", c: "red"   },
    { s: "♣", c: "black" },
    { s: "♠", c: "black" },
  ];
  const ranks = ["A","2","3","4","5","6","7","8","9","10","J","Q","K"];

  let deck = [];
  for (const suit of suits)
    for (const rank of ranks)
      deck.push({ rank, s: suit.s, c: suit.c });

  // Fisher-Yates shuffle — cryptographically good enough for a card game
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }

  // ── 4. Deal one face-up card to each column for both players ────────────
  const hostGrid  = Array.from({ length: 5 }, () => Array(5).fill("empty"));
  const clientGrid = Array.from({ length: 5 }, () => Array(5).fill("empty"));

  for (let c = 0; c < 5; c++) hostGrid[c][0]   = deck.pop();
  for (let c = 0; c < 5; c++) clientGrid[c][0] = deck.pop();

  const firstCard = deck.pop();

  // ── 5. Write to Firebase ────────────────────────────────────────────────
  // Both players' onValue listeners fire immediately after this write.
  await db.ref(`rooms/${roomCode}/gameState`).set({
    deck,
    hostGrid,
    clientGrid,
    activePlayer:   1,
    cardInHand:     firstCard,
    currentPhase:   1,
    showdownActive: false,
    phase3Turn:     0,
  });

  return { success: true };
});
