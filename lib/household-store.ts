import { env } from "cloudflare:workers";
import type { FirebaseUser } from "@/lib/firebase-auth";

type HouseholdRow = { id: number; name: string; invite_code: string | null; invite_expires_at: string | null; role: "owner" | "member" };
type AccessRequest = { id: number; userId: string; email: string; name: string; createdAt: string };

function database() {
  if (!env.DB) throw new Error("가정 공유 저장소가 아직 준비되지 않았습니다.");
  return env.DB;
}

export async function ensureUser(user: FirebaseUser) {
  const db = database();
  await db.prepare(`
    INSERT INTO users (id, email, display_name) VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET email = excluded.email, display_name = excluded.display_name, updated_at = CURRENT_TIMESTAMP
  `).bind(user.id, user.email, user.name).run();
}

export async function currentHousehold(user: FirebaseUser): Promise<HouseholdRow> {
  const db = database();
  await ensureUser(user);
  let household = await db.prepare(`
    SELECT h.id, h.name, h.invite_code, h.invite_expires_at, hm.role
    FROM household_members hm JOIN households h ON h.id = hm.household_id
    WHERE hm.user_id = ? ORDER BY hm.joined_at DESC, hm.rowid DESC LIMIT 1
  `).bind(user.id).first<HouseholdRow>();
  if (household) return household;
  const created = await db.prepare("INSERT INTO households (name) VALUES (?)").bind(`${user.name}의 장부`).run();
  const householdId = Number(created.meta.last_row_id);
  await db.prepare("INSERT INTO household_members (household_id, user_id, role) VALUES (?, ?, 'owner')").bind(householdId, user.id).run();
  household = await db.prepare(`
    SELECT h.id, h.name, h.invite_code, h.invite_expires_at, hm.role
    FROM household_members hm JOIN households h ON h.id = hm.household_id
    WHERE h.id = ? AND hm.user_id = ?
  `).bind(householdId, user.id).first<HouseholdRow>();
  if (!household) throw new Error("가정 장부를 만들지 못했습니다.");
  return household;
}

export async function householdSummary(user: FirebaseUser) {
  const db = database();
  const household = await currentHousehold(user);
  const members = await db.prepare(`
    SELECT u.id, u.email, u.display_name AS name, hm.role, hm.joined_at AS joinedAt
    FROM household_members hm JOIN users u ON u.id = hm.user_id
    WHERE hm.household_id = ? ORDER BY CASE hm.role WHEN 'owner' THEN 0 ELSE 1 END, hm.joined_at
  `).bind(household.id).all<{ id: string; email: string; name: string; role: string; joinedAt: string }>();
  const requests = household.role === "owner" ? await db.prepare(`
    SELECT r.id, u.id AS userId, u.email, u.display_name AS name, r.created_at AS createdAt
    FROM household_access_requests r JOIN users u ON u.id = r.requester_user_id
    WHERE r.household_id = ? AND r.status = 'pending'
    ORDER BY r.created_at DESC, r.id DESC
  `).bind(household.id).all<AccessRequest>() : { results: [] as AccessRequest[] };
  return { household, members: members.results || [], requests: requests.results || [] };
}

export async function setInviteCode(user: FirebaseUser, code: string) {
  const db = database();
  const household = await currentHousehold(user);
  if (household.role !== "owner") throw new Error("장부 소유자만 초대 코드를 만들 수 있습니다.");
  await db.prepare("UPDATE households SET invite_code = ?, invite_expires_at = datetime('now', '+7 days'), updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(code, household.id).run();
  return householdSummary(user);
}

export async function requestHouseholdAccess(user: FirebaseUser, code: string) {
  const db = database();
  await ensureUser(user);
  const target = await db.prepare("SELECT id, name FROM households WHERE invite_code = ? AND invite_expires_at > CURRENT_TIMESTAMP")
    .bind(code).first<{ id: number; name: string }>();
  if (!target) throw new Error("초대 코드가 없거나 유효기간이 지났습니다.");
  const member = await db.prepare("SELECT 1 AS exists FROM household_members WHERE household_id = ? AND user_id = ?")
    .bind(target.id, user.id).first<{ exists: number }>();
  if (member) return { status: "already_member" as const, householdName: target.name };
  await db.prepare(`
    INSERT INTO household_access_requests (household_id, requester_user_id, status) VALUES (?, ?, 'pending')
    ON CONFLICT(household_id, requester_user_id) DO UPDATE SET status = 'pending', updated_at = CURRENT_TIMESTAMP
  `).bind(target.id, user.id).run();
  return { status: "pending" as const, householdName: target.name };
}

export async function decideHouseholdAccessRequest(user: FirebaseUser, requestId: number, decision: "approve" | "reject") {
  const db = database();
  const household = await currentHousehold(user);
  if (household.role !== "owner") throw new Error("장부 소유자만 접속 요청을 처리할 수 있습니다.");
  const request = await db.prepare(`
    SELECT id, requester_user_id AS requesterUserId FROM household_access_requests
    WHERE id = ? AND household_id = ? AND status = 'pending'
  `).bind(requestId, household.id).first<{ id: number; requesterUserId: string }>();
  if (!request) throw new Error("처리할 수 없는 접속 요청입니다.");
  if (decision === "approve") {
    await db.batch([
      db.prepare("UPDATE household_access_requests SET status = 'approved', updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(request.id),
      db.prepare("INSERT INTO household_members (household_id, user_id, role) VALUES (?, ?, 'member') ON CONFLICT(household_id, user_id) DO NOTHING").bind(household.id, request.requesterUserId),
    ]);
  } else {
    await db.prepare("UPDATE household_access_requests SET status = 'rejected', updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(request.id).run();
  }
  return householdSummary(user);
}

export async function readLedger(user: FirebaseUser) {
  const db = database();
  const household = await currentHousehold(user);
  const row = await db.prepare("SELECT data, version, updated_at AS updatedAt FROM household_ledgers WHERE household_id = ?")
    .bind(household.id).first<{ data: string; version: number; updatedAt: string }>();
  return { householdId: household.id, data: row ? JSON.parse(row.data) : null, version: row?.version || 0, updatedAt: row?.updatedAt || null };
}

export async function writeLedger(user: FirebaseUser, data: unknown) {
  const db = database();
  const household = await currentHousehold(user);
  const serialized = JSON.stringify(data);
  if (serialized.length > 2_000_000) throw new Error("공유 장부 데이터가 너무 큽니다.");
  await db.prepare(`
    INSERT INTO household_ledgers (household_id, data, version, updated_by) VALUES (?, ?, 1, ?)
    ON CONFLICT(household_id) DO UPDATE SET data = excluded.data, version = household_ledgers.version + 1, updated_by = excluded.updated_by, updated_at = CURRENT_TIMESTAMP
  `).bind(household.id, serialized, user.id).run();
  return readLedger(user);
}
