import { firebaseUserFromRequest } from "@/lib/firebase-auth";
import { decideHouseholdAccessRequest } from "@/lib/household-store";

export async function POST(request: Request) {
  const user = await firebaseUserFromRequest(request);
  if (!user) return Response.json({ message: "로그인이 필요합니다." }, { status: 401 });
  const body = await request.json().catch(() => null) as { requestId?: unknown; decision?: unknown } | null;
  const requestId = typeof body?.requestId === "number" ? body.requestId : 0;
  const decision = body?.decision === "approve" || body?.decision === "reject" ? body.decision : null;
  if (!Number.isInteger(requestId) || requestId < 1 || !decision) return Response.json({ message: "접속 요청 정보를 확인해주세요." }, { status: 400 });
  try { return Response.json(await decideHouseholdAccessRequest(user, requestId, decision)); }
  catch (error) { return Response.json({ message: error instanceof Error ? error.message : "접속 요청을 처리하지 못했습니다." }, { status: 400 }); }
}
