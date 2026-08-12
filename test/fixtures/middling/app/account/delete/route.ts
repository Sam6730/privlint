// Middling fixture: a careful app ships the rights paths. This account-deletion
// endpoint is why the missing-deletion-path check stays silent here — the check
// only confirms the path is reachable, not that it erases everything.
export async function POST(): Promise<Response> {
  // ...tear down the account and its data...
  return new Response("account scheduled for deletion");
}
