import { firebaseUserFromRequest } from "@/lib/firebase-auth";
import { householdSummary } from "@/lib/household-store";

export async function GET(request: Request) {
  const user = await firebaseUserFromRequest(request);
  if (!user) return Response.json({ message: "로그인이 필요합니다." }, { status: 401 });
  try { return Response.json(await householdSummary(user), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return Response.json({ message: error instanceof Error ? error.message : "가정 정보를 불러오지 못했습니다." }, { status: 500 }); }
}
