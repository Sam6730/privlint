#!/usr/bin/env bash
#
# setup-demo.sh — (re)stage the two demo repos the recording runs against.
#
#   demo/my-app     a "responsible but flawed" Next.js app, hand-crafted to
#                   produce a TIGHT, varied report rather than a wall of findings.
#                   It HAS a /privacy page, a deletion route and an export route
#                   (so those noisy checks stay silent), leaving a curated set
#                   that spans every severity and all three determination types:
#                     [CRITICAL] committed AWS key        secrets   · checked in code
#                     [HIGH]     card data in logs        logging   · checked in code
#                     [HIGH]     no signed DPAs           dpa       · you told us   (from the questionnaire)
#                     [HIGH]     undisclosed: Stripe      data...   · reasoned about (from the model)
#                     [MEDIUM]   email in a URL           urls      · checked in code
#   demo/clean-app  a clean app -> zero findings (the closing green silence).
#
# clean-app is derived from the committed clean fixture so it can't drift from
# what CI asserts. my-app is bespoke to the demo. `demo/` is disposable and
# gitignored. Idempotent: safe to re-run.

set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

rm -rf demo/my-app demo/clean-app
mkdir -p demo
cp -R test/fixtures/clean demo/clean-app

mkdir -p demo/my-app/app/api/charge demo/my-app/app/privacy \
         demo/my-app/app/account/delete demo/my-app/app/account/export

cat > demo/my-app/package.json <<'EOF'
{
  "name": "my-app",
  "version": "1.0.0",
  "private": true,
  "dependencies": { "next": "^14.0.0", "stripe": "^14.0.0" }
}
EOF

cat > demo/my-app/app/api/charge/route.ts <<'EOF'
import Stripe from "stripe";

// Credential committed straight into the repo instead of read from the env.
const AWS_ACCESS_KEY_ID = "AKIAIOSFODNN7EXAMPLE";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function POST(req: Request): Promise<Response> {
  const { email, cardNumber } = await req.json();

  // Card data written straight to the logs.
  console.log("charge failed", cardNumber, AWS_ACCESS_KEY_ID);

  // Personal data baked into a third-party URL (leaks via referrer/logs).
  await fetch(`https://receipts.example.com/send?email=${email}`);

  await stripe.charges.create({ amount: 1000, currency: "usd" });
  return new Response("ok");
}
EOF

# A real /privacy page — but it names NEITHER Stripe: that's what makes the
# judgment check a genuine code-vs-policy *drift* finding.
cat > demo/my-app/app/privacy/page.tsx <<'EOF'
export default function PrivacyPolicy() {
  return (
    <main>
      <h1>Privacy Policy</h1>
      <p>
        We care about your privacy. We collect the information you provide to
        operate the service, and we do not sell your personal data. Contact us
        at privacy@my-app.example to exercise your rights.
      </p>
    </main>
  );
}
EOF

# A deletion route and an export route so those presence checks stay silent —
# this app did those things right; the demo is about the ones it didn't.
cat > demo/my-app/app/account/delete/route.ts <<'EOF'
// Right-to-erasure endpoint: deletes the signed-in user's account and data.
export async function POST(): Promise<Response> {
  return new Response("account deleted");
}
EOF

cat > demo/my-app/app/account/export/route.ts <<'EOF'
// Right-to-access endpoint: returns a copy of the user's personal data.
export async function GET(): Promise<Response> {
  return new Response("{}");
}
EOF

echo "Staged demo/my-app (curated) and demo/clean-app."
