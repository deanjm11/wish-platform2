const express = require("express");
const { Pool } = require("pg");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const app = express();
app.use(express.json());

const db = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

let wishCounter = 0;
const assignAvatar = () => {
  wishCounter++;
  if (wishCounter % 1500000 === 0) return { tier: "APEX", redeemUpTo: 100 };
  if (wishCounter % 10000 === 0) return { tier: "ELITE", redeemUpTo: 50 };
  if (wishCounter % 500 === 0) return { tier: "CONTRIBUTOR", redeemUpTo: 20 };
  return { tier: "COMMON", redeemUpTo: 0 };
};

app.get("/health", async (req, res) => { await db.query("SELECT 1"); res.json({ status: "healthy" }); });

app.post("/webhook", express.raw({type: "application/json"}), async (req, res) => {
  const event = stripe.webhooks.constructEvent(req.body, req.headers["stripe-signature"], process.env.STRIPE_WEBHOOK_SECRET);
  if (event.type === "checkout.session.completed") {
    const { userId, credits } = event.data.object.metadata;
    await db.query(`INSERT INTO users (id, credits) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET credits = users.credits + $2`, [userId, parseInt(credits)]);
  }
  res.json({ received: true });
});

app.post("/create-payment-intent", async (req, res) => {
  const bundles = { starter: { amount: 499, credits: 10 }, standard: { amount: 999, credits: 20 }, premium: { amount: 1999, credits: 40 } };
  const bundle = bundles[req.body.bundleId];
  const paymentIntent = await stripe.paymentIntents.create({ amount: bundle.amount, currency: "usd", metadata: { userId: req.body.userId, credits: bundle.credits } });
  res.json({ clientSecret: paymentIntent.client_secret });
});

app.post("/wish", async (req, res) => {
  const user = await db.query("SELECT credits FROM users WHERE id = $1", [req.body.userId]);
  if (!user.rows[0]?.credits) return res.status(402).json({ error: "No credits" });
  await db.query("UPDATE users SET credits = credits - 1 WHERE id = $1", [req.body.userId]);
  const avatar = assignAvatar();
  const wish = await db.query("INSERT INTO wishes (user_id, text, avatar_tier) VALUES ($1, $2, $3) RETURNING *", [req.body.userId, req.body.text.substring(0, 500), avatar.tier]);
  res.json({ wish: wish.rows[0], avatar });
});

app.get("/user/:id", async (req, res) => {
  const user = await db.query("SELECT * FROM users WHERE id = $1", [req.params.id]);
  const wishes = await db.query("SELECT * FROM wishes WHERE user_id = $1", [req.params.id]);
  res.json({ user: user.rows[0], wishes: wishes.rows });
});

app.listen(process.env.PORT || 3000, () => console.log("Running on " + (process.env.PORT || 3000)));
