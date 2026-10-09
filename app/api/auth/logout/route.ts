import { firebaseCookie } from "@/lib/firebase-auth";

export async function POST(request: Request) {
  return Response.json({ ok: true }, { headers: { "Set-Cookie": firebaseCookie("", request, 0) } });
}
