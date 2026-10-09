import { firebaseCookie, verifyFirebaseCredential } from "@/lib/firebase-auth";
import { currentHousehold } from "@/lib/household-store";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { credential?: unknown } | null;
  const credential = typeof body?.credential === "string" ? body.credential : "";
  if (!credential) return Response.json({ message: "Google 로그인 정보가 없습니다." }, { status: 400 });
  try {
    const user = await verifyFirebaseCredential(credential);
    await currentHousehold(user);
    return Response.json({ user }, { headers: { "Set-Cookie": firebaseCookie(credential, request) } });
  } catch (error) {
    return Response.json({ message: error instanceof Error ? error.message : "Google 로그인에 실패했습니다." }, { status: 401 });
  }
}
