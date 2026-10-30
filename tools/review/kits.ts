/** Review harness: the moves each species knows at each level (stdin: JSON [[dex, level], ...]). */
import { movesAt, species } from '../../src/sim/data';
const pairs: Array<[string, number]> = JSON.parse(process.argv[2]!);
console.log(JSON.stringify(Object.fromEntries(pairs.map(([d, l]) => [`${d}@${l}`, movesAt(species(d), l)]))));
