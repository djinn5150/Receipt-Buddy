import fetch from 'node-fetch';
import dotenv from 'dotenv';
dotenv.config();

async function run() {
  const res = await fetch(`${process.env.GROCY_URL}/api/objects/recipes/1`, {
    method: 'DELETE',
    headers: { 'GROCY-API-KEY': process.env.GROCY_API_KEY! }
  });
  console.log(res.status, await res.text());
}
run();
