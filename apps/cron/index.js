const url = process.env.CRON_URL;

if (!url) {
  console.error("Missing CRON_URL env var.");
  process.exit(1);
}

async function run() {
  const response = await fetch(url, { method: "POST" });
  const text = await response.text();

  if (!response.ok) {
    console.error(`Cron request failed: ${response.status}`);
    console.error(text);
    process.exit(1);
  }

  console.log(text);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
