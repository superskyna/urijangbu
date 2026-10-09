import { firebaseUserFromRequest } from "@/lib/firebase-auth";
import { requestHouseholdAccess } from "@/lib/household-store";

export async function POST(request: Request) {
  const user = await firebaseUserFromRequest(request);
  if (!user) return Response.json({ message: "로그인이 필요합니다." }, { status: 401 });
  const body = await request.json().catch(() => null) as { code?: unknown } | null;
  const code = typeof body?.code === "string" ? body.code.trim().toUpperCase() : "";
  if (!/^[2-9A-HJ-NP-Z]{8}$/.test(code)) return Response.json({ message: "8자리 초대 코드를 확인해주세요." }, { status: 400 });
  try { return Response.json(await requestHouseholdAccess(user, code)); }
  catch (error) { return Response.json({ message: error instanceof Error ? error.message : "접속 권한을 요청하지 못했습니다." }, { status: 400 }); }
}
