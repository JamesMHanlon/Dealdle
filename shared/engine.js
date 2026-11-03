"use strict";
// Card engine and badge definitions. Loaded by server.js (require) and by the browser (window.Engine).
// A card is an int 0..51: rank index = c % 13 (0 = "2" .. 12 = "A"), suit = Math.floor(c / 13) (S, H, D, C).
// Cards are drawn with replacement, so identical cards can appear.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Engine = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const HAND_SIZE = 7;
  const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
  const SUITS = ["S", "H", "D", "C"];
  const SUIT_SYMBOL = { S: "♠", H: "♥", D: "♦", C: "♣" };

  const rv = c => (c % 13) + 2;                 // 2..14, ace high
  const pip = c => (rv(c) === 14 ? 1 : rv(c));  // ace counts 1 for sums
  const suit = c => Math.floor(c / 13);
  const red = c => suit(c) === 1 || suit(c) === 2;
  const card = (rank, s) => SUITS.indexOf(s) * 13 + RANKS.indexOf(rank);
  const label = c => RANKS[c % 13] + SUIT_SYMBOL[SUITS[suit(c)]];

  function randomCard(rand) { return Math.floor(rand() * 52); }

  // Facts computed once per hand; every badge check reads from this.
  function facts(cards) {
    const rankCount = new Array(15).fill(0);
    const suitCount = [0, 0, 0, 0];
    const cardCount = new Array(52).fill(0);
    let sum = 0;
    for (const c of cards) { rankCount[rv(c)]++; suitCount[suit(c)]++; cardCount[c]++; sum += pip(c); }
    rankCount[1] = rankCount[14];
    const groups = rankCount.slice(2).filter(n => n > 0).sort((a, b) => b - a);
    const rvs = cards.map(rv);
    return { cards, rankCount, suitCount, cardCount, sum, groups, pips: cards.map(pip),
      maxRank: groups[0], maxSuit: Math.max(...suitCount), maxClone: Math.max(...cardCount),
      maxRv: Math.max(...rvs), minRv: Math.min(...rvs), reds: cards.filter(red).length,
      faces: rankCount[11] + rankCount[12] + rankCount[13],
      suitRanks: [0, 1, 2, 3].map(s => suitedRankCount({ cards }, s)) };
  }

  // Longest run of consecutive ranks (ace both low and high) in a rank-count table.
  function longestRun(rc) {
    let best = 0, run = 0;
    for (let r = 1; r <= 14; r++) { run = rc[r] > 0 ? run + 1 : 0; best = Math.max(best, run); }
    return best;
  }
  function suitedRankCount(f, s) {
    const rc = new Array(15).fill(0);
    for (const c of f.cards) if (suit(c) === s) rc[rv(c)]++;
    rc[1] = rc[14];
    return rc;
  }
  const has = (f, ...cs) => cs.every(c => f.cardCount[c] > 0);
  const ranksPresent = (f, ...rs) => rs.every(r => f.rankCount[r] > 0);
  const isPrime = n => { if (n < 2) return false; for (let i = 2; i * i <= n; i++) if (n % i === 0) return false; return true; };

  function anySuit(f, test) { for (let s = 0; s < 4; s++) if (test(f.suitRanks[s], s)) return true; return false; }
  const straightFlush = f => anySuit(f, rc => longestRun(rc) >= 5);
  const royalFlush = f => anySuit(f, rc => rc[10] && rc[11] && rc[12] && rc[13] && rc[14]);
  const flushHouse = f => anySuit(f, rc => {
    const g = rc.slice(2).filter(n => n > 0).sort((a, b) => b - a);
    return g[0] >= 3 && g[1] >= 2;
  });

  // ---------- generated badges ----------
  // About a thousand badges built from rules (every specific full house, card, total, slot, ...).
  // Most sit in a family so a hand doesn't pile up dozens of near-identical scores.
  const RN = ["Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Jack", "Queen", "King", "Ace"];
  const RP = ["Twos", "Threes", "Fours", "Fives", "Sixes", "Sevens", "Eights", "Nines", "Tens", "Jacks", "Queens", "Kings", "Aces"];
  const SN = ["Spades", "Hearts", "Diamonds", "Clubs"], SS = ["Spade", "Heart", "Diamond", "Club"], SY = ["♠", "♥", "♦", "♣"];
  const pipName = p => (p === 1 ? "A" : RANKS[p - 2]);
  const aOrAn = w => (/^[AE]/.test(w) ? "an " : "a ") + w;
  const choose = (n, k) => { let r = 1; for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i; return r; };
  const pEq = (q, k) => choose(HAND_SIZE, k) * Math.pow(q, k) * Math.pow(1 - q, HAND_SIZE - k);
  // chance that each of m specific outcomes (each with chance q per card) shows up at least once
  const pAll = (m, q) => { let s = 0; for (let j = 0; j <= m; j++) s += (j % 2 ? -1 : 1) * choose(m, j) * Math.pow(Math.max(0, 1 - j * q), HAND_SIZE); return s; };
  const pGe = (q, k) => { let s = 0; for (let j = k; j <= HAND_SIZE; j++) s += pEq(q, j); return s; };
  const SUM_P = (() => { // exact distribution of the card total
    let d = [1];
    for (let i = 0; i < HAND_SIZE; i++) {
      const n = new Array(d.length + 13).fill(0);
      d.forEach((v, s) => { if (v) for (let p = 1; p <= 13; p++) n[s + p] += v / 13; });
      d = n;
    }
    return d;
  })();
  const isSquare = n => Number.isInteger(Math.sqrt(n));
  const FIBS = new Set([8, 13, 21, 34, 55, 89]);

  function generatedBadges(base, B) {
    const taken = new Set(base.map(b => b.id)), out = [];
    const add = (...a) => { const b = B(...a); if (!taken.has(b.id)) { taken.add(b.id); out.push(b); } };
    const cardName = c => RN[c % 13] + " of " + SN[suit(c)];
    const famous = new Set([card("A", "S"), card("K", "H"), card("K", "D"), card("Q", "S"), card("7", "D"), card("9", "D")]);

    // Specific cards: present, twice, three times
    for (let c = 0; c < 52; c++) {
      const sy = SY[suit(c)];
      if (!famous.has(c)) add(`card_${c}`, cardName(c), sy, `The ${cardName(c)}.`, f => f.cardCount[c] >= 1, { family: "card", p: pGe(1 / 52, 1) });
      add(`card2_${c}`, `Double ${cardName(c)}`, "👯", `The ${cardName(c)} twice.`, f => f.cardCount[c] >= 2, { family: "cardclone", p: pGe(1 / 52, 2) });
      add(`card3_${c}`, `Triple ${cardName(c)}`, "🪞", `The ${cardName(c)} three times.`, f => f.cardCount[c] >= 3, { family: "cardclone", p: pGe(1 / 52, 3) });
    }

    // Rank multiples: Pair of Kings .. Seven Kings
    const kindName = ["", "", "Pair of ", "Three ", "Four ", "Five ", "Six ", "Seven "], kindEmoji = ["", "", "👫", "☘️", "🍀", "🖐️", "🎲", "🌟"];
    for (let i = 0; i < 13; i++) for (let k = 2; k <= 7; k++)
      add(`rank${k}_${i}`, kindName[k] + RP[i], kindEmoji[k], `${k} or more ${RP[i]}.`, f => f.rankCount[i + 2] >= k, { family: `rank_${i}`, p: pGe(1 / 13, k) });

    // Every two pair and every full house
    for (let i = 0; i < 13; i++) for (let j = 0; j < 13; j++) {
      if (j < i) add(`tp_${i}_${j}`, `${RP[i]} and ${RP[j]}`, "✌️", `A pair of ${RP[i]} and a pair of ${RP[j]}.`,
        f => f.rankCount[i + 2] >= 2 && f.rankCount[j + 2] >= 2, { family: "tp" });
      if (j !== i) add(`fh_${i}_${j}`, `${RP[i]} Full of ${RP[j]}`, "🏠", `Three ${RP[i]} and two ${RP[j]}.`,
        f => f.rankCount[i + 2] >= 3 && f.rankCount[j + 2] >= 2, { family: "fh" });
    }

    // Straights by top card, and straight flushes by suit and top card
    for (let h = 5; h <= 14; h++) {
      const top = RN[h - 2];
      add(`straight_${h}`, `${top}-High Straight`, "📏", `A straight up to ${aOrAn(top)}.`,
        f => [0, 1, 2, 3, 4].every(d => f.rankCount[h - d] > 0), { family: "straight_high", p: pAll(5, 1 / 13) });
      for (let s = 0; s < 4; s++) add(`sf_${s}_${h}`, `${top}-High ${SS[s]} Straight Flush`, "🌈", `${SN[s]} in a row up to ${aOrAn(top)}.`,
        f => [0, 1, 2, 3, 4].every(d => f.suitRanks[s][h - d] > 0), { family: "sf_high", p: pAll(5, 1 / 52) });
    }

    // Suit counts
    for (let s = 0; s < 4; s++) {
      add(`flush_${s}`, `${SS[s]} Flush`, SY[s], `Five or more ${SN[s]}.`, f => f.suitCount[s] >= 5, { family: "flush_suit", p: pGe(0.25, 5) });
      add(`six_${s}`, `Six ${SN[s]}`, SY[s], `Six or more ${SN[s]}.`, f => f.suitCount[s] >= 6, { family: "flush_suit", p: pGe(0.25, 6) });
      if (s >= 2) add(`seven_${s}`, ["Gravedigger", "Lovesick", "Diamond Mine", "Clover Field"][s], SY[s], `Seven ${SN[s]}.`, f => f.suitCount[s] === 7, { family: "flush_suit", p: pEq(0.25, 7) });
      for (let k = 0; k <= 6; k++) {
        if (s === 0 && k === 0) continue;
        add(`suit${k}_${s}`, k === 0 ? `No ${SN[s]}` : `Exactly ${k} ${k === 1 ? SS[s] : SN[s]}`, SY[s],
          k === 0 ? `Not a single ${SS[s].toLowerCase()}.` : `Exactly ${k} ${(k === 1 ? SS[s] : SN[s]).toLowerCase()}.`,
          f => f.suitCount[s] === k, { family: `suitcount_${s}`, p: pEq(0.25, k) });
      }
    }
    for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++)
      add(`suitpair_${a}${b}`, `Only ${SN[a]} and ${SN[b]}`, SY[a] + SY[b], `Every card is a ${SS[a].toLowerCase()} or a ${SS[b].toLowerCase()}, with both.`,
        f => f.suitCount[a] > 0 && f.suitCount[b] > 0 && f.suitCount[a] + f.suitCount[b] === 7, { family: "suitset" });
    for (let k = 1; k <= 6; k++)
      add(`reds_${k}`, `${k} Red, ${7 - k} Black`, "🎴", `Exactly ${k} red card${k > 1 ? "s" : ""}.`, f => f.reds === k, { family: "redcount", p: pEq(0.5, k) });

    // Card totals
    for (let s = 7; s <= 91; s++)
      add(`sum_${s}`, `Total of ${s}`, "🧮", `Card total is exactly ${s}.`, f => f.sum === s, { family: "sum", p: SUM_P[s] });
    for (let n = 2; n <= 13; n++)
      add(`div_${n}`, `Divisible by ${n}`, "➗", `Card total divides by ${n}.`, f => f.sum % n === 0, { family: "divis" });
    add("sum_square", "Square Total", "🟦", "Card total is a perfect square.", f => isSquare(f.sum));
    add("sum_cube", "Cube Total", "🧊", "Card total is 8, 27 or 64.", f => [8, 27, 64].includes(f.sum));
    add("sum_tri", "Triangular Total", "🔺", "Card total is a triangular number.", f => isSquare(8 * f.sum + 1));
    add("sum_pow2", "Binary Total", "💾", "Card total is 8, 16, 32 or 64.", f => [8, 16, 32, 64].includes(f.sum));
    add("sum_fib", "Fibonacci Total", "🌀", "Card total is a Fibonacci number.", f => FIBS.has(f.sum));

    // Shape of the hand
    for (let k = 2; k <= 6; k++)
      add(`distinct_${k}`, `${k} Different Ranks`, "🎆", `Exactly ${k} different ranks.`, f => f.groups.length === k, { family: "distinctcount" });
    for (let k = 0; k <= 6; k++)
      add(`faces_${k}`, `${k} Face Card${k === 1 ? "" : "s"}`, "🤴", `Exactly ${k} J, Q or K.`, f => f.faces === k, { family: "facecount", p: pEq(3 / 13, k) });
    for (let i = 0; i < 13; i++) {
      add(`highest_${i}`, `Tops Out at ${RN[i]}`, "⬆️", `The highest card is ${aOrAn(RN[i])} (aces high).`, f => f.maxRv === i + 2, { family: "highest", p: Math.pow((i + 1) / 13, 7) - Math.pow(i / 13, 7) });
      add(`lowest_${i}`, `Bottoms Out at ${RN[i]}`, "⬇️", `The lowest card is ${aOrAn(RN[i])} (aces high).`, f => f.minRv === i + 2, { family: "lowest", p: Math.pow((13 - i) / 13, 7) - Math.pow((12 - i) / 13, 7) });
    }

    // Suited connectors and any two ranks together
    for (let s = 0; s < 4; s++) for (let i = 0; i < 12; i++)
      add(`conn_${s}_${i}`, `${RANKS[i]}${SY[s]}${RANKS[i + 1]}${SY[s]} Connectors`, "🔗", `The ${cardName(s * 13 + i)} and ${cardName(s * 13 + i + 1)}.`,
        f => f.cardCount[s * 13 + i] > 0 && f.cardCount[s * 13 + i + 1] > 0, { family: "connector", p: pAll(2, 1 / 52) });
    for (let i = 0; i < 13; i++) for (let j = i + 1; j < 13; j++)
      add(`duo_${j}_${i}`, `${RANKS[j]} & ${RANKS[i]}`, "🤝", `At least one ${RN[j]} and one ${RN[i]}.`,
        f => f.rankCount[j + 2] > 0 && f.rankCount[i + 2] > 0, { family: "duo", p: pAll(2, 1 / 13) });
    for (let len = 3; len <= 4; len++) for (let lo = 1; lo + len - 1 <= 14; lo++) {
      const seq = Array.from({ length: len }, (_, d) => lo + d), names = seq.map(r => (r === 1 || r === 14 ? "A" : RANKS[r - 2]));
      add(`run${len}_${lo}`, `${names.join("-")} Run`, "🧗", `Holds ${names.join(", ")} (any suits, any order).`,
        f => seq.every(r => f.rankCount[r] > 0), { family: "rankrun", p: pAll(len, 1 / 13) });
    }

    // Card order, left to right
    for (let pos = 0; pos < HAND_SIZE; pos++) for (let i = 0; i < 13; i++)
      add(`slot${pos}_${i}`, `${RN[i]} in Slot ${pos + 1}`, "🎯", `Card ${pos + 1} is ${aOrAn(RN[i])}.`, f => rv(f.cards[pos]) === i + 2, { family: "slot", p: 1 / 13 });
    for (let i = 0; i < 13; i++) {
      add(`opens_${i}`, `Opens with ${aOrAn(RN[i])}`, "🚪", `The first card is ${aOrAn(RN[i])}.`, f => rv(f.cards[0]) === i + 2, { family: "opener", p: 1 / 13 });
      add(`closes_${i}`, `Closes with ${aOrAn(RN[i])}`, "🔚", `The last card is ${aOrAn(RN[i])}.`, f => rv(f.cards[HAND_SIZE - 1]) === i + 2, { family: "closer", p: 1 / 13 });
    }
    for (let pos = 0; pos < HAND_SIZE - 1; pos++)
      add(`adj_${pos}`, `Twins in Slots ${pos + 1}-${pos + 2}`, "👬", `Cards ${pos + 1} and ${pos + 2} share a rank.`,
        f => rv(f.cards[pos]) === rv(f.cards[pos + 1]), { family: "adjacent", p: 1 / 13 });
    for (let len = 3; len <= 4; len++) for (let a = 1; a + len - 1 <= 13; a++) {
      const seq = Array.from({ length: len }, (_, d) => a + d);
      add(`ladder${len}_${a}`, `Ladder ${seq.map(pipName).join("-")}`, "🪜", `${seq.map(pipName).join(", ")} side by side, in that order.`,
        f => { for (let k = 0; k + len <= HAND_SIZE; k++) if (seq.every((p, t) => f.pips[k + t] === p)) return true; return false; },
        { family: "ladder" });
    }
    return out;
  }

  // Badges. family: only the highest-scoring badge per family counts towards EP.
  // p: exact probability for badges too rare to measure by simulation (else calibrate.js measures it).
  const B = (id, name, emoji, desc, check, extra = {}) => ({ id, name, emoji, desc, check, ...extra });
  const BADGES = [
    // Poker hands (best five cards)
    B("high_card", "High Card", "🃏", "No pair, straight or flush.", f => f.maxRank === 1 && f.maxSuit < 5 && longestRun(f.rankCount) < 5, { family: "hand" }),
    B("pair", "Pair", "👫", "Two cards of the same rank.", f => f.maxRank >= 2, { family: "hand" }),
    B("two_pair", "Two Pair", "✌️", "Two different pairs.", f => f.groups[1] >= 2, { family: "hand" }),
    B("trips", "Three of a Kind", "☘️", "Three cards of the same rank.", f => f.maxRank >= 3, { family: "hand" }),
    B("straight", "Straight", "📏", "Five ranks in a row.", f => longestRun(f.rankCount) >= 5, { family: "hand" }),
    B("flush", "Flush", "🌊", "Five cards of one suit.", f => f.maxSuit >= 5, { family: "hand" }),
    B("full_house", "Full House", "🏠", "Three of a kind plus a pair.", f => f.groups[0] >= 3 && f.groups[1] >= 2, { family: "hand" }),
    B("quads", "Four of a Kind", "🍀", "Four cards of the same rank.", f => f.maxRank >= 4, { family: "hand" }),
    B("straight_flush", "Straight Flush", "🌈", "Five suited cards in a row.", straightFlush, { family: "hand" }),
    B("royal_flush", "Royal Flush", "👑", "10, J, Q, K, A of one suit.", royalFlush, { family: "hand" }),
    B("five_kind", "Five of a Kind", "🖐️", "Five cards of the same rank.", f => f.maxRank >= 5, { family: "hand" }),
    B("flush_house", "Flush House", "🏰", "A full house all in one suit.", flushHouse, { family: "hand" }),
    B("flush_five", "Flush Five", "💠", "Five identical cards.", f => f.maxClone >= 5, { family: "hand", p: 2.87e-6 }),

    // Beyond five cards
    B("six_kind", "Six of a Kind", "🎲", "Six cards of the same rank.", f => f.maxRank >= 6, { family: "kind" }),
    B("seven_kind", "Seven of a Kind", "🌟", "All seven cards share a rank.", f => f.maxRank >= 7, { family: "kind", p: Math.pow(1 / 13, 6) }),
    B("three_pair", "Three Pair", "🧦", "Three different pairs.", f => f.groups[2] >= 2, { family: "groups" }),
    B("two_trips", "Double Trouble", "🔱", "Two different three of a kinds.", f => f.groups[1] >= 3, { family: "groups" }),
    B("quads_trips", "Mansion", "🏛️", "Four of a kind plus three of a kind.", f => f.groups[0] >= 4 && f.groups[1] >= 3, { family: "groups" }),
    B("twin_card", "Déjà Vu", "👯", "The exact same card twice.", f => f.maxClone >= 2, { family: "clone" }),
    B("triplet_card", "Triple Vision", "🪞", "The exact same card three times.", f => f.maxClone >= 3, { family: "clone" }),
    B("quad_card", "Clone Army", "🤖", "The exact same card four times.", f => f.maxClone >= 4, { family: "clone" }),
    B("double_twin", "Echo Chamber", "📣", "Two different cards each appear twice.", f => f.cardCount.filter(n => n >= 2).length >= 2),
    B("seven_clones", "Singularity", "🕳️", "Seven identical cards.", f => f.maxClone >= 7, { family: "clone2", p: 1 / Math.pow(52, 6) }),
    B("suited_six", "Six Suited", "🎨", "Six cards of one suit.", f => f.maxSuit >= 6, { family: "suit" }),
    B("suited_seven", "Pure Suit", "💎", "All seven cards share a suit.", f => f.maxSuit >= 7, { family: "suit" }),
    B("six_straight", "Long Road", "🛣️", "Six ranks in a row.", f => longestRun(f.rankCount) >= 6, { family: "run" }),
    B("seven_straight", "Grand Staircase", "🪜", "Seven ranks in a row.", f => longestRun(f.rankCount) >= 7, { family: "run" }),
    B("wheel", "The Wheel", "🛞", "A, 2, 3, 4, 5.", f => ranksPresent(f, 14, 2, 3, 4, 5)),
    B("broadway", "Broadway", "🎭", "10, J, Q, K, A.", f => ranksPresent(f, 10, 11, 12, 13, 14)),
    B("seven_sf", "Rainbow Bridge", "🌉", "Six or more suited cards in a row.", f => anySuit(f, rc => longestRun(rc) >= 6)),

    // Suits and colours
    B("rainbow", "Rainbow", "🏳️‍🌈", "All four suits.", f => f.suitCount.every(n => n > 0)),
    B("balanced", "Balanced", "⚖️", "Suits split 2-2-2-1.", f => f.suitCount.slice().sort().join("") === "1222"),
    B("all_red", "Seeing Red", "🟥", "Every card is red.", f => f.cards.every(red), { family: "color" }),
    B("all_black", "Blackout", "⬛", "Every card is black.", f => f.cards.every(c => !red(c)), { family: "color" }),
    B("all_hearts", "Lovesick", "💘", "Seven hearts.", f => f.suitCount[1] === 7, { family: "suit" }),
    B("all_spades", "Gravedigger", "⚰️", "Seven spades.", f => f.suitCount[0] === 7, { family: "suit" }),
    B("no_spades", "Spadeless", "🚫", "Not a single spade.", f => f.suitCount[0] === 0),
    B("alternating", "Zebra", "🦓", "Colours alternate left to right.", f => f.cards.every((c, i) => i === 0 || red(c) !== red(f.cards[i - 1]))),

    // Ranks
    B("royal_court", "Royal Court", "🫅", "A Jack, Queen and King.", f => ranksPresent(f, 11, 12, 13), { family: "court" }),
    B("full_court", "Full Court", "🤴", "Five or more face cards.", f => f.rankCount[11] + f.rankCount[12] + f.rankCount[13] >= 5, { family: "court" }),
    B("all_faces", "Masquerade", "🦹", "Seven face cards.", f => f.rankCount[11] + f.rankCount[12] + f.rankCount[13] === 7, { family: "court" }),
    B("no_faces", "Commoners", "🧑‍🌾", "No J, Q, K or A.", f => f.cards.every(c => rv(c) <= 10)),
    B("low_ball", "Low Ball", "🐜", "Every card 7 or lower (aces low).", f => f.cards.every(c => pip(c) <= 7)),
    B("high_roller", "High Roller", "🎩", "Every card 10 or higher.", f => f.cards.every(c => rv(c) >= 10)),
    B("all_even", "Even Stevens", "🟰", "Every rank even (Q = 12).", f => f.cards.every(c => pip(c) % 2 === 0), { family: "parity" }),
    B("all_odd", "Odd Ones", "🧩", "Every rank odd (A = 1, J = 11, K = 13).", f => f.cards.every(c => pip(c) % 2 === 1), { family: "parity" }),
    B("all_prime", "Prime Time", "🔢", "Every rank prime (2, 3, 5, 7, J, K).", f => f.cards.every(c => isPrime(pip(c)))),
    B("fibonacci", "Fibonacci", "🐚", "A, 2, 3, 5, 8 and K (13).", f => ranksPresent(f, 1, 2, 3, 5, 8, 13)),
    B("distinct", "Scattered", "🎆", "Seven different ranks.", f => f.maxRank === 1),
    B("aces2", "Pocket Rockets", "🚀", "Two aces.", f => f.rankCount[14] >= 2, { family: "aces" }),
    B("aces3", "Ace Squad", "🛩️", "Three aces.", f => f.rankCount[14] >= 3, { family: "aces" }),
    B("aces4", "Ace Fleet", "🛸", "Four aces.", f => f.rankCount[14] >= 4, { family: "aces" }),
    B("snowmen", "Snowmen", "⛄", "Two or more 8s.", f => f.rankCount[8] >= 2),
    B("ducks", "Ducks", "🦆", "Two or more 2s.", f => f.rankCount[2] >= 2),
    B("devil", "Devil's Hand", "😈", "Three or more 6s.", f => f.rankCount[6] >= 3),
    B("jackpot", "Jackpot", "🎰", "Three or more 7s.", f => f.rankCount[7] >= 3),
    B("hammer", "The Hammer", "🔨", "A 7 and a 2 of different suits.", f => f.cards.some(a => rv(a) === 7 && f.cards.some(b => rv(b) === 2 && suit(b) !== suit(a)))),
    B("big_slick", "Big Slick", "🏎️", "Ace and King of the same suit.", f => [0, 1, 2, 3].some(s => f.cardCount[s * 13 + 12] && f.cardCount[s * 13 + 11])),
    B("marriage", "Marriage", "💍", "King and Queen of the same suit.", f => [0, 1, 2, 3].some(s => f.cardCount[s * 13 + 11] && f.cardCount[s * 13 + 10])),
    B("royal_wedding", "Royal Wedding", "💒", "King and Queen of hearts.", f => has(f, card("K", "H"), card("Q", "H"))),
    B("four_queens", "Ladies' Night", "💃", "A Queen of every suit.", f => SUITS.every(s => f.cardCount[card("Q", s)])),
    B("four_aces", "Full Deck of Aces", "🂡", "An Ace of every suit.", f => SUITS.every(s => f.cardCount[card("A", s)])),

    // Famous cards
    B("death_card", "Death Card", "💀", "The Ace of Spades.", f => has(f, card("A", "S"))),
    B("suicide_king", "Suicide King", "🗡️", "The King of Hearts.", f => has(f, card("K", "H"))),
    B("axe_man", "Man with the Axe", "🪓", "The King of Diamonds.", f => has(f, card("K", "D"))),
    B("black_maria", "Black Maria", "🕷️", "The Queen of Spades.", f => has(f, card("Q", "S"))),
    B("beer_card", "Beer Card", "🍺", "The 7 of Diamonds.", f => has(f, card("7", "D"))),
    B("curse_scotland", "Curse of Scotland", "🏴", "The 9 of Diamonds.", f => has(f, card("9", "D"))),
    B("one_eyed", "One-Eyed Jacks", "👁️", "Jack of Spades and Jack of Hearts.", f => has(f, card("J", "S"), card("J", "H"))),
    B("dead_man", "Dead Man's Hand", "🤠", "Black aces and black eights.", f => has(f, card("A", "S"), card("A", "C"), card("8", "S"), card("8", "C"))),

    // Card sums (A = 1, J = 11, Q = 12, K = 13)
    B("sum_prime", "Prime Total", "➗", "Card total is prime.", f => isPrime(f.sum)),
    B("sum_21", "Blackjack", "🂱", "Card total is exactly 21.", f => f.sum === 21, { family: "sum" }),
    B("sum_42", "Meaning", "🌌", "Card total is exactly 42.", f => f.sum === 42, { family: "sum" }),
    B("sum_49", "Perfect Square", "🟩", "Card total is exactly 49.", f => f.sum === 49, { family: "sum" }),
    B("sum_69", "Nice", "😏", "Card total is exactly 69.", f => f.sum === 69, { family: "sum" }),
    B("sum_77", "Lucky Total", "🎯", "Card total is exactly 77.", f => f.sum === 77, { family: "sum" }),
    B("sum_low", "Featherweight", "🪶", "Card total of 15 or less.", f => f.sum <= 15, { family: "sum" }),
    B("sum_high", "Heavyweight", "🏋️", "Card total of 80 or more.", f => f.sum >= 80, { family: "sum" }),

    // Card order, left to right
    B("ascending", "Escalator", "📈", "Ranks never go down, left to right.", f => f.cards.every((c, i) => i === 0 || pip(c) >= pip(f.cards[i - 1])), { family: "order" }),
    B("descending", "Avalanche", "📉", "Ranks never go up, left to right.", f => f.cards.every((c, i) => i === 0 || pip(c) <= pip(f.cards[i - 1])), { family: "order" }),
    B("countdown", "Countdown", "⏳", "Seven ranks counting down by one.", f => f.cards.every((c, i) => i === 0 || pip(c) === pip(f.cards[i - 1]) - 1), { family: "order", p: 7 * Math.pow(1 / 13, 7) }),
    B("palindrome", "Palindrome", "🔁", "Ranks read the same both ways.", f => [0, 1, 2].every(i => rv(f.cards[i]) === rv(f.cards[6 - i])), { family: "mirror" }),
    B("mirror", "Perfect Mirror", "🪩", "Cards read the same both ways.", f => [0, 1, 2].every(i => f.cards[i] === f.cards[6 - i]), { family: "mirror", p: Math.pow(1 / 52, 3) }),
    B("bookends", "Bookends", "📚", "First and last cards share a rank.", f => rv(f.cards[0]) === rv(f.cards[6])),
    B("center_ace", "Centre Stage", "🎤", "An ace dead centre.", f => rv(f.cards[3]) === 14),
    B("pi", "Pi", "🥧", "Reads 3, A, 4, A, 5, 9, 2.", f => f.cards.map(pip).join(",") === "3,1,4,1,5,9,2", { p: Math.pow(1 / 13, 7) }),
  ];

  BADGES.push(...generatedBadges(BADGES, B));
  const BY_ID = Object.fromEntries(BADGES.map(b => [b.id, b]));
  let STATS = null; // { scores: {id: ep}, probs: {id: p}, percentiles: [[ep, pct], ...] }
  function setStats(s) { STATS = s; }

  function analyze(cards) {
    const f = facts(cards);
    const earned = BADGES.filter(b => b.check(f)).map(b => b.id);
    if (!STATS) return { cards, badges: earned.map(id => ({ id })), scoring: earned, total: 0 };
    const best = new Map(), loose = [];
    for (const id of earned) {
      const fam = BY_ID[id].family, sc = STATS.scores[id] || 0;
      if (!fam) loose.push(id);
      else if (!best.has(fam) || sc > STATS.scores[best.get(fam)]) best.set(fam, id);
    }
    const scoring = new Set([...loose, ...best.values()]);
    const badges = earned.map(id => ({ id, score: STATS.scores[id] || 0, scoring: scoring.has(id) }))
      .sort((a, b) => b.score - a.score);
    const total = badges.reduce((t, b) => t + (b.scoring ? b.score : 0), 0);
    return { cards, badges, total };
  }

  // Percentage of rolls (made with a simple hold strategy) that scored below `total`.
  function percentile(total) {
    if (!STATS) return 0;
    const t = STATS.percentiles;
    let lo = 0, hi = t.length - 1, ans = 0;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (t[m][0] <= total) { ans = t[m][1]; lo = m + 1; } else hi = m - 1; }
    return ans;
  }
  const RARITY = [
    [99, "Mythic"], [95, "Anomaly"], [90, "Epic"], [75, "Rare"], [50, "Uncommon"], [1, "Common"], [0, "Trash"],
  ];
  const rarityOf = pct => RARITY.find(([min]) => pct >= min)[1];
  function badgeRarity(p) {
    if (p > 0.1) return "Common"; if (p > 0.01) return "Uncommon"; if (p > 0.001) return "Rare";
    if (p > 0.0001) return "Epic"; if (p > 0.00001) return "Anomaly"; return "Mythic";
  }

  // The strategy used to build the percentile table: keep the biggest rank group (pairs or better),
  // otherwise four or more of one suit, otherwise nothing.
  function autoHold(cards) {
    const f = facts(cards);
    if (f.maxRank >= 2) {
      const r = f.rankCount.findIndex((n, i) => i >= 2 && n === f.maxRank);
      return cards.map(c => rv(c) === r);
    }
    if (f.maxSuit >= 4) { const s = f.suitCount.indexOf(f.maxSuit); return cards.map(c => suit(c) === s); }
    return cards.map(() => false);
  }

  return { HAND_SIZE, RANKS, SUITS, SUIT_SYMBOL, BADGES, BY_ID, rv, suit, red, label, randomCard,
    analyze, setStats, percentile, rarityOf, badgeRarity, autoHold, get stats() { return STATS; } };
});
