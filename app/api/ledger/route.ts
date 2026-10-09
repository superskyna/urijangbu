import { firebaseUserFromRequest } from "@/lib/firebase-auth";
import { readLedger, writeLedger } from "@/lib/household-store";

export async function GET(request: Request) {
  const user = await firebaseUserFromRequest(request);
  if (!user) return Response.json({ message: "로그인이 필요합니다." }, { status: 401 });
  try { return Response.json(await readLedger(user), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return Response.json({ message: error instanceof Error ? error.message : "공유 장부를 불러오지 못했습니다." }, { status: 500 }); }
}

export async function PUT(request: Request) {
  const user = await firebaseUserFromRequest(request);
  if (!user) return Response.json({ message: "로그인이 필요합니다." }, { status: 401 });
  const body = await request.json().catch(() => null) as { data?: unknown } | null;
  if (!body || !("data" in body)) return Response.json({ message: "저장할 장부 데이터가 없습니다." }, { status: 400 });
  try { return Response.json(await writeLedger(user, body.data)); }
  catch (error) { return Response.json({ message: error instanceof Error ? error.message : "공유 장부를 저장하지 못했습니다." }, { status: 500 }); }
}
