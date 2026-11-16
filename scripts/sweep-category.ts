// npm run sweep:category — task 4.1 scorecard; recorded results only, no key, no spend.
import { sweepByCategory } from '../src/eval/sweep-category.js';
console.log((await sweepByCategory()).join('\n'));
