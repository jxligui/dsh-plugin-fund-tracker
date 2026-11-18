import { openDb } from '../lib/store.js';
import { fetchIndices } from '../lib/market.js';
const db = openDb();
const { indices, etfs } = await fetchIndices(db);
console.log('indices:', indices.length, JSON.stringify(indices.slice(0, 3)));
console.log('etfs:', etfs.length, JSON.stringify(etfs.slice(0, 5)));
db.close();
process.exit(0);
