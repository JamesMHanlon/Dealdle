"use strict";
// Measures how often each badge appears in a random 7-card deal and writes shared/stats.json:
//   scores:      EP per badge = 10 / probability (rarer badges are worth more)
//   probs:       the probability itself (shown on badge pages)
//   percentiles: total-EP thresholds, from rolls played with Engine.autoHold, for the roll rarity tiers
// Usage: node tools/calibrate.js [samples]   (default 2,000,000; takes about a minute)
const fs = require("fs");
const path = require("path");
const Engine = require("../shared/engine");

const N = Number(process.argv[2]) || 2_000_000;
const rand = Math.random;
const deal = () => Array.from({ length: Engine.HAND_SIZE }, () => Engine.randomCard(rand));

const counts = Object.fromEntries(Engine.BADGES.map(b => [b.id, 0]));
for (let i = 0; i < N; i++) for (const { id } of Engine.analyze(deal()).badges) counts[id]++;

const probs = {}, scores = {};
for (const b of Engine.BADGES) {
  const measured = counts[b.id] / N;
  const p = b.p !== undefined ? b.p : Math.max(measured, 0.5 / N);
  probs[b.id] = p;
  scores[b.id] = Math.max(1, Math.round(10 / p));
  if (counts[b.id] < 30) console.log(`rare: ${b.id} seen ${counts[b.id]}x, using p=${p.toExponential(2)}`);
}
Engine.setStats({ scores, probs, percentiles: [] });

const M = Math.min(N, 500_000), totals = [];
for (let i = 0; i < M; i++) {
  const cards = deal(), hold = Engine.autoHold(cards);
  totals.push(Engine.analyze(cards.map((c, j) => (hold[j] ? c : Engine.randomCard(rand)))).total);
}
totals.sort((a, b) => a - b);
const percentiles = [];
for (let i = 0; i < M; i++) {
  // each distinct total maps to the % of rolls that scored strictly less
  if (i === 0 || totals[i] !== totals[i - 1]) percentiles.push([totals[i], +((100 * i) / M).toFixed(4)]);
}

fs.writeFileSync(path.join(__dirname, "../shared/stats.json"), JSON.stringify({ scores, probs, percentiles }));
console.log(`${Engine.BADGES.length} badges, ${percentiles.length} percentile steps, median total ${totals[M >> 1]} EP`);
