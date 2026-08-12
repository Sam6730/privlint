// Leaky fixture: the mistakes a rushed founder makes all at once —
// hard-coded credentials, PII (incl. card data) in logs, personal data pushed
// into a tracking URL and an analytics event, third-party SDKs wired, and
// (repo-wide) no /privacy page. The secrets and both leak checks all fire here.
import { Analytics } from "@segment/analytics-node";
import Stripe from "stripe";

// Credentials committed straight into the repo instead of read from the env.
const AWS_ACCESS_KEY_ID = "AKIAIOSFODNN7EXAMPLE";
const INTERNAL_API_KEY = "sk_internal_9f2c8b7a6e5d4c3b2a1f0e9d8c7b6a5f";

const stripe = new Stripe(INTERNAL_API_KEY);
const analytics = new Analytics({ writeKey: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6" });

export async function POST(req: Request): Promise<Response> {
  const { email, cardNumber } = await req.json();

  // Personal + card data written straight to the logs.
  console.log("charging customer", email, cardNumber, AWS_ACCESS_KEY_ID);

  analytics.track({ userId: email, event: "charge", properties: { email } });

  // Personal data baked into a third-party tracking URL (leaks via referrer/logs).
  await fetch(`https://track.example.com/hit?email=${email}`);

  await stripe.charges.create({ amount: 1000, currency: "usd" });

  return new Response("ok");
}
