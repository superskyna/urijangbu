import type { User } from "firebase/auth";
import { Timestamp, collection, doc, getDoc, getDocs, limit, onSnapshot, orderBy, query, runTransaction, serverTimestamp, setDoc, updateDoc, where, writeBatch } from "firebase/firestore";
import { firebaseDb } from "@/lib/firebase-client";

export type FirebaseAccount = { id: string; email: string; name: string; picture: string };
export type HouseholdSummary = { household: { id: string; name: string; invite_code: string | null; invite_expires_at: string | null; role: "owner" | "member" }; members: { id: string; email: string; name: string; role: string; joinedAt: string }[]; requests: { id: string; userId: string; email: string; name: string; createdAt: string }[] };

const account = (user: User): FirebaseAccount => ({ id: user.uid, email: user.email || "", name: user.displayName || user.email?.split("@")[0] || "사용자", picture: user.photoURL || "" });
const asDate = (value: unknown) => value instanceof Timestamp ? value.toDate().toISOString() : "";
const householdRef = (id: string) => doc(firebaseDb, "households", id);
const memberRef = (householdId: string, userId: string) => doc(firebaseDb, "households", householdId, "members", userId);
const ledgerRef = (householdId: string) => doc(firebaseDb, "households", householdId, "ledger", "current");
const profileRef = (userId: string) => doc(firebaseDb, "profiles", userId);

async function activeHouseholdId(user: User) {
  const profile = await getDoc(profileRef(user.uid));
  if (profile.exists()) return profile.data().activeHouseholdId as string;
  const id = doc(collection(firebaseDb, "households")).id;
  const me = account(user);
  await runTransaction(firebaseDb, async transaction => {
    if ((await transaction.get(profileRef(user.uid))).exists()) return;
    transaction.set(householdRef(id), { name: `${me.name}의 장부`, ownerId: user.uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    transaction.set(memberRef(id, user.uid), { ...me, role: "owner", joinedAt: serverTimestamp() });
    transaction.set(profileRef(user.uid), { userId: user.uid, activeHouseholdId: id, updatedAt: serverTimestamp() });
  });
  const created = await getDoc(profileRef(user.uid));
  return created.data()?.activeHouseholdId as string;
}

export async function firebaseHouseholdSummary(user: User): Promise<HouseholdSummary> {
  const householdId = await activeHouseholdId(user);
  const [household, membership, members] = await Promise.all([getDoc(householdRef(householdId)), getDoc(memberRef(householdId, user.uid)), getDocs(query(collection(firebaseDb, "households", householdId, "members"), orderBy("joinedAt")))]);
  if (!household.exists() || !membership.exists()) throw new Error("가정 장부 권한을 확인하지 못했습니다.");
  const memberData = membership.data();
  const role = memberData.role as "owner" | "member";
  const requests = role === "owner" ? await getDocs(query(collection(firebaseDb, "households", householdId, "requests"), where("status", "==", "pending"), orderBy("createdAt"))) : null;
  return {
    household: { id: householdId, name: household.data().name as string, invite_code: role === "owner" ? (household.data().inviteCode || null) : null, invite_expires_at: role === "owner" ? asDate(household.data().inviteExpiresAt) || null : null, role },
    members: members.docs.map(item => ({ id: item.id, email: item.data().email || "", name: item.data().name || "사용자", role: item.data().role, joinedAt: asDate(item.data().joinedAt) })),
    requests: requests?.docs.map(item => ({ id: item.id, userId: item.data().requesterId, email: item.data().email || "", name: item.data().name || "사용자", createdAt: asDate(item.data().createdAt) })) || [],
  };
}

export async function firebaseCreateInvite(user: User) {
  const summary = await firebaseHouseholdSummary(user);
  if (summary.household.role !== "owner") throw new Error("장부 소유자만 초대 코드를 만들 수 있습니다.");
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  const code = Array.from(crypto.getRandomValues(new Uint8Array(8)), value => alphabet[value % alphabet.length]).join("");
  const expiresAt = Timestamp.fromDate(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
  await writeBatch(firebaseDb).set(doc(firebaseDb, "invites", code), { householdId: summary.household.id, expiresAt, createdAt: serverTimestamp() }).update(householdRef(summary.household.id), { inviteCode: code, inviteExpiresAt: expiresAt, updatedAt: serverTimestamp() }).commit();
  return firebaseHouseholdSummary(user);
}

export async function firebaseRequestAccess(user: User, code: string) {
  const invite = await getDoc(doc(firebaseDb, "invites", code));
  if (!invite.exists() || !(invite.data().expiresAt instanceof Timestamp) || invite.data().expiresAt.toMillis() <= Date.now()) throw new Error("초대 코드가 없거나 유효기간이 지났습니다.");
  const householdId = invite.data().householdId as string;
  const me = account(user);
  await setDoc(doc(firebaseDb, "households", householdId, "requests", user.uid), { requesterId: user.uid, ...me, inviteCode: code, status: "pending", createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  return { status: "pending" as const };
}

export async function firebaseDecideAccessRequest(user: User, requestUserId: string, decision: "approve" | "reject") {
  const summary = await firebaseHouseholdSummary(user);
  if (summary.household.role !== "owner") throw new Error("장부 소유자만 접속 요청을 처리할 수 있습니다.");
  const request = await getDoc(doc(firebaseDb, "households", summary.household.id, "requests", requestUserId));
  if (!request.exists() || request.data().status !== "pending") throw new Error("처리할 수 없는 접속 요청입니다.");
  const batch = writeBatch(firebaseDb);
  batch.update(request.ref, { status: decision === "approve" ? "approved" : "rejected", updatedAt: serverTimestamp() });
  if (decision === "approve") {
    batch.set(memberRef(summary.household.id, requestUserId), { id: requestUserId, email: request.data().email || "", name: request.data().name || "사용자", picture: request.data().picture || "", role: "member", joinedAt: serverTimestamp() });
    batch.set(profileRef(requestUserId), { userId: requestUserId, activeHouseholdId: summary.household.id, updatedAt: serverTimestamp() }, { merge: true });
  }
  await batch.commit();
  return firebaseHouseholdSummary(user);
}

export async function firebaseReadLedger(user: User) {
  const householdId = await activeHouseholdId(user);
  const row = await getDoc(ledgerRef(householdId));
  return row.exists() ? row.data().data || null : null;
}

export async function firebaseWriteLedger(user: User, data: unknown) {
  const householdId = await activeHouseholdId(user);
  await setDoc(ledgerRef(householdId), { data: removeUndefined(data), updatedAt: serverTimestamp(), updatedBy: user.uid }, { merge: true });
}

/** Firestore does not accept undefined values anywhere in a document. */
function removeUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map(item => removeUndefined(item)) as T;
  if (value && typeof value === "object" && !(value instanceof Timestamp) && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).flatMap(([key, nested]) =>
        nested === undefined ? [] : [[key, removeUndefined(nested)]],
      ),
    ) as T;
  }
  return value;
}

export function firebaseAccount(user: User) { return account(user); }
export function subscribeFirebaseProfile(user: User, onChange: () => void) { return onSnapshot(profileRef(user.uid), onChange); }

export async function subscribeFirebasePendingRequests(user: User, onChange: () => void) {
  const summary = await firebaseHouseholdSummary(user);
  if (summary.household.role !== "owner") return () => undefined;
  return onSnapshot(
    query(collection(firebaseDb, "households", summary.household.id, "requests"), where("status", "==", "pending"), orderBy("createdAt")),
    onChange,
  );
}
