import fetch from "node-fetch";

async function run() {
  const res = await fetch("https://demo.grocy.info/api/objects/quantity_unit_conversions", {
    method: "POST",
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from_qu_id: 1, // Example ID
      to_qu_id: 2,   // Example ID
      factor: 3,
      product_id: 1
    })
  });
  console.log("POST /api/objects/quantity_unit_conversions", res.status, res.statusText, await res.text());
}
run();
