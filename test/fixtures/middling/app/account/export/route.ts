// Middling fixture: the data-export counterpart to the deletion route, so the
// missing-export-path check stays silent here too.
export async function GET(): Promise<Response> {
  // ...gather the user's data and return it...
  return new Response("{}", { headers: { "content-type": "application/json" } });
}
