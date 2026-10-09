import { firebaseProjectId, firebaseUserFromRequest } from "@/lib/firebase-auth";

export async function GET(request: Request) {
  const projectId = firebaseProjectId();
  const user = await firebaseUserFromRequest(request);
  return Response.json({ configured: Boolean(projectId), projectId, user }, { headers: { "Cache-Control": "no-store" } });
}
