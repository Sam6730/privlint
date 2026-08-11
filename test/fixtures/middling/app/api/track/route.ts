// Middling fixture: mostly careful, one slip. Analytics runs through Mixpanel,
// there is a real /privacy page — but one credential got hard-coded instead of
// read from the environment. That single committed secret is what the check
// flags; everything else here is deliberately clean.
import Mixpanel from "mixpanel";

// The one slip: a token committed into the source instead of read from env.
const MIXPANEL_TOKEN = "9f2c8b7a6e5d4c3b2a1f0e9d8c7b6a5f";

const mixpanel = Mixpanel.init(MIXPANEL_TOKEN);

export async function POST(req: Request): Promise<Response> {
  const { userId } = await req.json();
  mixpanel.track("page_view", { distinct_id: userId });
  return new Response("ok");
}
