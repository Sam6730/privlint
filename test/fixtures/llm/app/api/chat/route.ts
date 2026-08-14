// LLM fixture: a repo that calls an LLM API with user-supplied text. It reads its
// key from the env and discloses OpenAI in /privacy, so the drift check stays
// silent — what remains is the LLM-disclosure judgment: user data reaching a
// model provider in a prompt, where a lawful basis can't be confirmed from code.
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY ?? "" });

export async function POST(req: Request): Promise<Response> {
  const { message } = await req.json();

  // Whatever the user typed is sent to OpenAI in the prompt.
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: message }],
  });

  return Response.json({ reply: completion.choices[0]?.message.content });
}
