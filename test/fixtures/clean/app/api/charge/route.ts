// Clean fixture: the reference for "no findings." Every credential is read from
// the environment, nothing personal is logged, and the app ships /privacy and
// /terms pages. A regression that makes this repo produce ANY finding is a false
// positive and fails the build (see the hard CI gate in the fixture tests).
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "");

export async function POST(): Promise<Response> {
  await stripe.charges.create({ amount: 1000, currency: "usd" });
  return new Response("ok");
}
