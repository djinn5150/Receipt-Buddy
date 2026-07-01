const fetch = require('node-fetch');
require('dotenv').config();
async function run() {
  const res = await fetch(`${process.env.GROCY_URL}/api/objects/userfield_values`, {
    headers: { 'GROCY-API-KEY': process.env.GROCY_API_KEY }
  });
  if (res.ok) {
    const data = await res.json();
    console.log(data.slice(0, 5));
  } else {
    console.log(res.status, await res.text());
  }
}
run();
