import {existsSync} from 'node:fs';
for(const p of ['public/index.html','public/app.js','public/favicon.svg','netlify/functions/api.mjs','server/api-core.mjs','shared.mjs'])if(!existsSync(p))throw Error('Missing '+p);console.log('FIZY Netlify source validated');
