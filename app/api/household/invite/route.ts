import { firebaseUserFromRequest } from "@/lib/firebase-auth";
import { setInviteCode } from "@/lib/household-store";

const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const inviteCode = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), (value) => alphabet[value % alphabet.length]).join("");

export async function POST(request: Request) {
  const user = await firebaseUserFromRequest(request);
  if (!user) return Response.json({ message: "로그인이 필요합니다." }, { status: 401 });
  try { return Response.json(await setInviteCode(user, inviteCode())); }
  catch (error) { return Response.json({ message: error instanceof Error ? error.message : "초대 코드를 만들지 못했습니다." }, { status: 400 }); }
}
