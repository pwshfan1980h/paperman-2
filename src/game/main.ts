import { Game } from './game';

const canvas = document.createElement('canvas');
document.body.prepend(canvas);
const game = new Game(canvas);
game.start();
Object.assign(window, { game });
const m = location.hash.match(/play(\d)?/);
if (m) game.debugPlay(Number(m[1] ?? 0));
