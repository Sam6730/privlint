// Middling fixture: mostly careful, a couple of slips — enough to produce a
// subset of findings, not all and not none. There is a real /privacy page and
// nothing is logged, but one credential got hard-coded instead of read from the
// environment, and an email is passed as an analytics property. So the secrets
// check and the URLs/analytics check fire; the logs check stays silent.
import Mixpanel from "mixpanel";

// Slip one: a token committed into the source instead of read from env.
const MIXPANEL_TOKEN = "9f2c8b7a6e5d4c3b2a1f0e9d8c7b6a5f";

const mixpanel = Mixpanel.init(MIXPANEL_TOKEN);

export async function POST(req: Request): Promise<Response> {
  const { userId, email } = await req.json();
  // Slip two: personal data sent to analytics as an event property.
  mixpanel.track("page_view", { distinct_id: userId, email });
  return new Response("ok");
}
