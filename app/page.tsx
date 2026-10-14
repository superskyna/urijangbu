"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { ArrowDownLeft, ArrowUpRight, Bell, CalendarDays, ChevronDown, CircleDollarSign, CreditCard, Download, FileSpreadsheet, Gauge, Home, Landmark, Menu, Pencil, PiggyBank, Plus, RefreshCw, Search, Settings, Target, Trash2, TrendingUp, Upload, Users, WalletCards, X } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Legend as ChartLegend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Toaster } from "@/components/ui/sonner";
import { GettingStarted } from "@/components/getting-started";
import { parseFinanceFile, parseFinanceFileWithMapping, type ImportedTransaction, type ManualColumnMapping, type ManualImportSuggestion } from "@/lib/import-parser";
import { parseAssetFile } from "@/lib/asset-import-parser";
import { downloadTransactionTemplate } from "@/lib/transaction-template";
import { transactionCategories } from "@/lib/category-master";
import { firebaseAuth } from "@/lib/firebase-client";
import { firebaseAccount, firebaseCreateInvite, firebaseDecideAccessRequest, firebaseHouseholdSummary, firebaseReadLedger, firebaseRequestAccess, firebaseWriteLedger, subscribeFirebasePendingRequests, subscribeFirebaseProfile, type HouseholdSummary } from "@/lib/firebase-household";
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut as firebaseSignOut } from "firebase/auth";
type View = "dashboard" | "transactions" | "budget" | "assets" | "settings";
type Tx = {
    id: number;
    owner: string;
    date: string;
    merchant: string;
    category: string;
    account: string;
    amount: number;
};
type BudgetLimit = {
    category: string;
    limit: number;
    color: string;
};
type FixedCost = {
    id: number;
    name: string;
    amount: number;
    day: number;
};
type PaymentBenefit = {
    target: number;
    benefit: string;
};
const normalizePaymentBenefits = (value: unknown): Record<string, PaymentBenefit> => {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return {};
    return Object.fromEntries(Object.entries(value).flatMap(([account, setting]) => {
        if (!setting || typeof setting !== "object")
            return [];
        const row = setting as {
            target?: unknown;
            benefit?: unknown;
        };
        const target = Number(row.target);
        return account.trim() && Number.isFinite(target) && target > 0 ? [[account, { target, benefit: typeof row.benefit === "string" ? row.benefit : "" }]] : [];
    }));
};
type PendingManualImport = {
    file: File;
    suggestion: ManualImportSuggestion;
};
type GoogleAccount = {
    id: string;
    email: string;
    name: string;
    picture: string;
};
type AuthSession = {
    loading: boolean;
    configured: boolean;
    projectId: string;
    user: GoogleAccount | null;
};
type SharedLedgerSnapshot = {
    txs: Tx[];
    budgetLimits: BudgetLimit[];
    savingsTarget: number;
    fixedCosts: FixedCost[];
    paymentBenefits: Record<string, PaymentBenefit>;
    assetHistory: AssetHistory;
    nicknames: {
        me: string;
        partner: string;
    };
};
const LOCAL_LEDGER_KEY = "urijangbu:local-ledger";
const LOCAL_PRIVATE_DATA_KEYS = [LOCAL_LEDGER_KEY, "urijangbu:asset-history", "urijangbu:payment-benefits"];
const LOCAL_PRIVATE_DATA_PREFIXES = ["urijangbu:column-map:"];
const categories: string[] = [...transactionCategories];
const startTx: Tx[] = [];
const budgets: {
    name: string;
    used: number;
    limit: number;
    color: string;
}[] = [];
const money = (v: number) => `${Math.abs(v).toLocaleString("ko-KR")}원`;
const signedMoney = (v: number) => `${v < 0 ? "-" : ""}${Math.abs(v).toLocaleString("ko-KR")}원`;
const transactionDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : `${new Date().getFullYear()}-${value.replace(".", "-")}`;
const monthKey = (value: string) => transactionDate(value).slice(0, 7);
const previousMonthKey = (value: string) => { const [year, month] = value.split("-").map(Number); const previous = new Date(Date.UTC(year, month - 2, 1)); return `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, "0")}`; };
const dateLabel = (value: string) => { const date = transactionDate(value); return `${date.slice(5, 7)}.${date.slice(8, 10)}`; };
const monthLabel = (value: string) => { const [year, month] = value.split("-"); return `${year}년 ${Number(month)}월`; };
const todayKey = () => { const today = new Date(); return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`; };
const categoryColors = ["#20b894", "#4776e6", "#f3a83b", "#ef6b79", "#8b6bd6", "#24a5c7", "#de7d32", "#6aa84f", "#c35caa", "#627d98", "#c98276", "#2f855a", "#9a6a18", "#536dfe", "#b55c78", "#768591", "#7f8c4a", "#cf7048", "#8c97a2"];
export default function HomePage() {
    const [view, setView] = useState<View>("dashboard");
    const [menu, setMenu] = useState(false);
    const [txs, setTxs] = useState(startTx);
    const [add, setAdd] = useState(false);
    const [upload, setUpload] = useState(false);
    const [activeMonth, setActiveMonth] = useState(monthKey(todayKey()));
    const [budgetLimits, setBudgetLimits] = useState<BudgetLimit[]>([]);
    const [savingsTarget, setSavingsTarget] = useState(0);
    const [fixedCosts, setFixedCosts] = useState<FixedCost[]>([]);
    const [paymentBenefits, setPaymentBenefits] = useState<Record<string, PaymentBenefit>>({});
    const [assetHistory, setAssetHistory] = useState<AssetHistory>({});
    const [assetHistoryReady, setAssetHistoryReady] = useState(false);
    const [manualImport, setManualImport] = useState<PendingManualImport | null>(null);
    const [manualMapping, setManualMapping] = useState<ManualColumnMapping | null>(null);
    const [nicknames, setNicknames] = useState({ me: "나", partner: "가족" });
    const [merchant, setMerchant] = useState("");
    const [amount, setAmount] = useState("");
    const [category, setCategory] = useState("식비");
    const [refreshing, setRefreshing] = useState(false);
    const [updated, setUpdated] = useState("아직 없음");
    const fileRef = useRef<HTMLInputElement>(null);
    const [auth, setAuth] = useState<AuthSession>({ loading: false, configured: false, projectId: "", user: null });
    const [sharedReady, setSharedReady] = useState(false);
    const [hadSharedSession, setHadSharedSession] = useState(false);
    const [localLedgerReady, setLocalLedgerReady] = useState(false);
    const [inviteCode, setInviteCode] = useState<string | null>(null);
    const inviteRequestInFlight = useRef<string | null>(null);
    const [pendingAccessRequests, setPendingAccessRequests] = useState<HouseholdSummary["requests"]>([]);
    const [accessPromptOpen, setAccessPromptOpen] = useState(false);
    const [handlingAccessRequest, setHandlingAccessRequest] = useState(false);
    const [showGettingStarted, setShowGettingStarted] = useState(false);
    const initializedMonthContext = useRef<string | null>(null);
    const activeMonthTransactions = useMemo(() => txs.filter(transaction => monthKey(transaction.date) === activeMonth), [txs, activeMonth]);
    const totals = useMemo(() => ({ income: activeMonthTransactions.filter(x => x.amount > 0).reduce((a, x) => a + x.amount, 0), expense: Math.abs(activeMonthTransactions.filter(x => x.amount < 0).reduce((a, x) => a + x.amount, 0)) }), [activeMonthTransactions]);
    const dashboardAssets = useMemo(() => resolveAssetSnapshot(assetHistory, activeMonth), [assetHistory, activeMonth]);
    const isEmptyLedger = !txs.length && !budgetLimits.length && !savingsTarget && !fixedCosts.length && !Object.keys(assetHistory).length;
    const latestRecordedMonth = useMemo(() => [...txs.map(transaction => monthKey(transaction.date)), ...Object.keys(assetHistory)].filter(month => /^\d{4}-\d{2}$/.test(month)).sort((a, b) => b.localeCompare(a))[0], [txs, assetHistory]);
    useEffect(() => { if (!localLedgerReady || (auth.user && !sharedReady))
        return; const context = auth.user?.id ?? "local"; if (initializedMonthContext.current === context)
        return; initializedMonthContext.current = context; if (latestRecordedMonth)
        setActiveMonth(latestRecordedMonth); }, [localLedgerReady, auth.user?.id, sharedReady, latestRecordedMonth]);
    useEffect(() => { try {
        const saved = localStorage.getItem("urijangbu:asset-history");
        if (saved)
            setAssetHistory(normalizeAssetHistory(JSON.parse(saved)));
    }
    catch { }
    finally {
        setAssetHistoryReady(true);
    } }, []);
    useEffect(() => { if (!assetHistoryReady || auth.user || hadSharedSession)
        return; localStorage.setItem("urijangbu:asset-history", JSON.stringify(assetHistory)); }, [assetHistory, auth.user, assetHistoryReady, hadSharedSession]);
    useEffect(() => { try {
        const saved = localStorage.getItem(LOCAL_LEDGER_KEY);
        if (saved) {
            const data = JSON.parse(saved) as Partial<SharedLedgerSnapshot>;
            if (Array.isArray(data.txs))
                setTxs(data.txs);
            if (Array.isArray(data.budgetLimits))
                setBudgetLimits(data.budgetLimits);
            if (typeof data.savingsTarget === "number")
                setSavingsTarget(data.savingsTarget);
            if (Array.isArray(data.fixedCosts))
                setFixedCosts(data.fixedCosts);
            if (data.paymentBenefits && typeof data.paymentBenefits === "object")
                setPaymentBenefits(data.paymentBenefits);
            if (data.assetHistory && typeof data.assetHistory === "object")
                setAssetHistory(normalizeAssetHistory(data.assetHistory));
            if (data.nicknames?.me && data.nicknames?.partner)
                setNicknames(data.nicknames);
        }
        const legacyBenefits = localStorage.getItem("urijangbu:payment-benefits");
        if (legacyBenefits)
            setPaymentBenefits(JSON.parse(legacyBenefits) as Record<string, PaymentBenefit>);
    }
    catch { }
    finally {
        setLocalLedgerReady(true);
    } }, []);
    useEffect(() => { if (!localLedgerReady || (auth.user && !sharedReady))
        return; setShowGettingStarted(isEmptyLedger); }, [localLedgerReady, auth.user, sharedReady, isEmptyLedger]);
    useEffect(() => { if (!localLedgerReady || auth.user || hadSharedSession)
        return; localStorage.setItem(LOCAL_LEDGER_KEY, JSON.stringify({ txs, budgetLimits, savingsTarget, fixedCosts, paymentBenefits, assetHistory, nicknames } satisfies SharedLedgerSnapshot)); }, [localLedgerReady, auth.user, hadSharedSession, txs, budgetLimits, savingsTarget, fixedCosts, paymentBenefits, assetHistory, nicknames]);
    useEffect(() => onAuthStateChanged(firebaseAuth, user => { setSharedReady(false); if (user)
        setHadSharedSession(true); setAuth({ loading: false, configured: true, projectId: "uri-jangbu", user: user ? firebaseAccount(user) : null }); }), []);
    useEffect(() => { const code = new URLSearchParams(location.search).get("invite")?.trim().toUpperCase() || ""; if (/^[2-9A-HJ-NP-Z]{8}$/.test(code))
        setInviteCode(code); }, []);
    const acceptGoogleAccount = useCallback((user: GoogleAccount) => setAuth(current => ({ ...current, user })), []);
    const clearLocalOnlyData = useCallback(() => {
        const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)).filter((key): key is string => Boolean(key));
        keys.filter(key => LOCAL_PRIVATE_DATA_KEYS.includes(key) || LOCAL_PRIVATE_DATA_PREFIXES.some(prefix => key.startsWith(prefix))).forEach(key => localStorage.removeItem(key));
        toast.success("이 기기의 로컬 장부 데이터를 삭제했습니다.", { description: "Google 계정과 Firebase에 저장된 장부는 그대로 유지됩니다." });
        window.setTimeout(() => location.reload(), 450);
    }, []);
    useEffect(() => { const user = firebaseAuth.currentUser; if (!auth.user || !user || !inviteCode || inviteRequestInFlight.current === inviteCode)
        return; const code = inviteCode; inviteRequestInFlight.current = code; firebaseRequestAccess(user, code).then(result => { history.replaceState({}, "", location.pathname); setInviteCode(null); toast.success(result.status === "already_member" ? "이미 이 장부의 구성원입니다." : "접속 권한 요청을 보냈습니다.", { description: result.status === "already_member" ? "현재 장부를 계속 사용합니다." : "소유자에게 승인 요청을 보냈습니다." }); }).catch(error => { inviteRequestInFlight.current = null; toast.error("접속 권한을 요청하지 못했습니다.", { description: error instanceof Error ? error.message : "초대 링크를 확인해주세요." }); }); }, [auth.user, inviteCode]);
    const authUserId = auth.user?.id;
    useEffect(() => { const user = firebaseAuth.currentUser; if (!authUserId || !user || !assetHistoryReady)
        return; let cancelled = false; const load = () => firebaseReadLedger(user).then(result => { if (cancelled)
        return; const data = result as Partial<SharedLedgerSnapshot> | null; if (data) {
        if (Array.isArray(data.txs))
            setTxs(data.txs);
        if (Array.isArray(data.budgetLimits))
            setBudgetLimits(data.budgetLimits);
        if (typeof data.savingsTarget === "number")
            setSavingsTarget(data.savingsTarget);
        if (Array.isArray(data.fixedCosts))
            setFixedCosts(data.fixedCosts);
        if (data.paymentBenefits && typeof data.paymentBenefits === "object")
            setPaymentBenefits(data.paymentBenefits);
        if (data.assetHistory && typeof data.assetHistory === "object")
            setAssetHistory(normalizeAssetHistory(data.assetHistory));
        if (data.nicknames?.me && data.nicknames?.partner)
            setNicknames(data.nicknames);
    } setSharedReady(true); }).catch(error => { if (!cancelled)
        toast.error("공유 장부를 불러오지 못했습니다.", { description: error instanceof Error ? error.message : "잠시 후 다시 시도해주세요." }); }); void load(); const unsubscribe = subscribeFirebaseProfile(user, () => void load()); return () => { cancelled = true; unsubscribe(); }; }, [authUserId, assetHistoryReady]);
    useEffect(() => { const user = firebaseAuth.currentUser; if (!authUserId || !user)
        return; let cancelled = false; let unsubscribe = () => undefined; const refreshRequests = () => firebaseHouseholdSummary(user).then(summary => { if (cancelled)
        return; if (summary.household.role !== "owner") {
        setPendingAccessRequests([]);
        setAccessPromptOpen(false);
        return;
    } setPendingAccessRequests(summary.requests); if (summary.requests.length)
        setAccessPromptOpen(true); }).catch(() => undefined); void subscribeFirebasePendingRequests(user, refreshRequests).then(listener => { if (cancelled)
        listener();
    else
        unsubscribe = listener; }).catch(() => undefined); return () => { cancelled = true; unsubscribe(); }; }, [authUserId]);
    useEffect(() => { const user = firebaseAuth.currentUser; if (!auth.user || !user || !sharedReady)
        return; const timer = window.setTimeout(() => { const data: SharedLedgerSnapshot = { txs, budgetLimits, savingsTarget, fixedCosts, paymentBenefits, assetHistory, nicknames }; firebaseWriteLedger(user, data).catch(error => toast.error("공유 장부 자동 저장에 실패했습니다.", { description: error instanceof Error ? error.message : "다시 시도해주세요." })); }, 900); return () => window.clearTimeout(timer); }, [auth.user, sharedReady, txs, budgetLimits, savingsTarget, fixedCosts, paymentBenefits, assetHistory, nicknames]);
    async function handleAccessRequest(requestId: string, decision: "approve" | "reject") { const user = firebaseAuth.currentUser; if (!user)
        return; setHandlingAccessRequest(true); try {
        const summary = await firebaseDecideAccessRequest(user, requestId, decision);
        setPendingAccessRequests(summary.requests);
        if (!summary.requests.length)
            setAccessPromptOpen(false);
        toast.success(decision === "approve" ? "접속을 승인했습니다." : "접속 요청을 거절했습니다.");
    }
    catch (error) {
        toast.error("접속 요청을 처리하지 못했습니다.", { description: error instanceof Error ? error.message : "다시 시도해주세요." });
    }
    finally {
        setHandlingAccessRequest(false);
    } }
    function dismissGettingStarted() { setShowGettingStarted(false); }
    function save() { const n = Number(amount.replaceAll(",", "")); if (!merchant.trim() || !n) {
        toast.error("거래처와 금액을 입력해주세요.");
        return;
    } setTxs(x => [{ id: Date.now(), owner: nicknames.me, date: todayKey(), merchant: merchant.trim(), category, account: "직접 입력", amount: -Math.abs(n) }, ...x]); setActiveMonth(monthKey(todayKey())); setMerchant(""); setAmount(""); setAdd(false); toast.success("지출을 기록했습니다."); }
    function updateTransaction(transaction: Tx) { setTxs(old => old.map(row => row.id === transaction.id ? transaction : row)); setActiveMonth(monthKey(transaction.date)); toast.success("거래 내용을 수정했습니다."); }
    function deleteTransaction(id: number) { setTxs(old => old.filter(row => row.id !== id)); toast.success("거래를 삭제했습니다."); }
    function applyImportedTransactions(result: {
        institution: string;
        transactions: ImportedTransaction[];
        replaceExisting: boolean;
        needsReview: number;
    }, notice: string | number) { const stamp = Date.now(); const imported = result.transactions.map((x, i) => ({ id: stamp + i, owner: x.owner || nicknames.me, date: x.date, merchant: x.merchant, category: x.category, account: x.account, amount: x.amount })); setTxs(old => result.replaceExisting ? imported : [...imported, ...old]); const importedMonth = imported.map(transaction => monthKey(transaction.date)).sort((a, b) => b.localeCompare(a))[0]; if (importedMonth)
        setActiveMonth(importedMonth); toast.success(`${result.institution} 가져오기 완료`, { id: notice, description: result.replaceExisting ? `양식의 ${imported.length}건으로 전체 거래를 갱신했습니다.` : `${imported.length}건 추가 · 확인 필요 ${result.needsReview}건` }); }
    async function importFile(file?: File) { if (!file)
        return; const ext = file.name.toLowerCase(); if (![".xlsx", ".csv"].some(x => ext.endsWith(x))) {
        toast.error("보안을 위해 XLSX 또는 CSV 파일만 가져올 수 있습니다.");
        return;
    } setUpload(false); const notice = toast.loading(`${file.name} 분석 중`); try {
        const result = await parseFinanceFile(file);
        if (result.transactions.length) {
            applyImportedTransactions(result, notice);
            return;
        }
        const suggestion = result.manualSuggestion;
        if (!suggestion)
            throw new Error("거래 열을 찾지 못했습니다.");
        const saved = localStorage.getItem(`urijangbu:column-map:${suggestion.signature}`);
        if (saved) {
            try {
                const mapped = await parseFinanceFileWithMapping(file, JSON.parse(saved) as ManualColumnMapping);
                if (mapped.transactions.length) {
                    applyImportedTransactions(mapped, notice);
                    return;
                }
            }
            catch {
                localStorage.removeItem(`urijangbu:column-map:${suggestion.signature}`);
            }
        }
        setManualImport({ file, suggestion });
        setManualMapping(suggestion.mapping);
        toast.info("처음 보는 양식이에요.", { id: notice, description: "거래 열만 확인하면 다음부터 자동으로 가져옵니다." });
    }
    catch (error) {
        toast.error("파일을 가져오지 못했습니다.", { id: notice, description: error instanceof Error ? error.message : "파일 형식을 확인해주세요." });
    }
    finally {
        if (fileRef.current)
            fileRef.current.value = "";
    } }
    async function importWithManualMapping() { if (!manualImport || !manualMapping)
        return; const notice = toast.loading("선택한 열로 거래를 확인하는 중"); try {
        const result = await parseFinanceFileWithMapping(manualImport.file, manualMapping);
        if (!result.transactions.length)
            throw new Error("선택한 열에서 가져올 거래를 찾지 못했습니다.");
        localStorage.setItem(`urijangbu:column-map:${manualImport.suggestion.signature}`, JSON.stringify(manualMapping));
        applyImportedTransactions(result, notice);
        setManualImport(null);
        setManualMapping(null);
    }
    catch (error) {
        toast.error("열 매핑을 적용하지 못했습니다.", { id: notice, description: error instanceof Error ? error.message : "선택한 열을 확인해주세요." });
    } }
    async function refresh(assetMonth: string) {
        if (refreshing)
            return;
        const user = firebaseAuth.currentUser;
        if (!user) {
            toast.info("시세 갱신은 Google 로그인 후 사용할 수 있어요.", { description: "API 키를 보호하기 위해 로그인한 사용자만 시세를 요청할 수 있습니다." });
            return;
        }
        const snapshot = resolveAssetSnapshot(assetHistory, assetMonth);
        const candidates = snapshot.holdings.map(row => ({ row, ticker: investmentTicker(row) })).filter(item => item.row.currency === "KRW" && item.ticker && item.row.quantity > 0);
        if (!candidates.length) {
            toast.error("갱신할 국내 종목이 없습니다.", { description: "투자 종목에 6자리 영문·숫자 종목코드와 보유수량을 입력해주세요." });
            return;
        }
        const workerUrl = import.meta.env.VITE_MARKET_WORKER_URL?.trim() || "https://urijangbu-market-api.superskyna.workers.dev/quotes";
        setRefreshing(true);
        const notice = toast.loading("최근 시세를 확인하는 중");
        try {
            const token = await user.getIdToken();
            const response = await fetch(workerUrl, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ symbols: candidates.map(item => item.ticker) }) });
            const data = await response.json().catch(() => null) as {
                quotes?: MarketQuote[];
                missing?: string[];
                message?: string;
            } | null;
            if (!response.ok)
                throw new Error(data?.message || `시세 요청 실패(${response.status})`);
            const quotes = new Map((data?.quotes || []).map(quote => [quote.ticker, quote]));
            if (!quotes.size) {
                throw new Error("조회 가능한 최근 시세를 찾지 못했습니다.");
            }
            setAssetHistory(history => { const base = resolveAssetSnapshot(history, assetMonth); return { ...history, [assetMonth]: { ...base, holdings: base.holdings.map(row => { const quote = quotes.get(investmentTicker(row)); return quote ? { ...row, name: row.name, market: quote.market || row.market, value: quote.price * row.quantity } : row; }) } }; });
            const latestDate = (data?.quotes || []).map(quote => quote.date).sort().at(-1) || "";
            setUpdated(latestDate ? `${latestDate.slice(0, 4)}.${latestDate.slice(4, 6)}.${latestDate.slice(6, 8)}` : "방금 전");
            toast.success(`${quotes.size}개 종목의 최근 시세를 반영했습니다.`, { id: notice, description: data?.missing?.length ? `조회되지 않은 종목 ${data.missing.join(", ")}` : undefined });
        }
        catch (error) {
            toast.error("최근 시세를 갱신하지 못했습니다.", { id: notice, description: error instanceof Error ? error.message : "잠시 후 다시 시도해주세요." });
        }
        finally {
            setRefreshing(false);
        }
    }
    useEffect(() => { const ctx = (document as Document & {
        modelContext?: {
            registerTool?: (a: unknown, b?: unknown) => void;
        };
    }).modelContext; if (!ctx?.registerTool)
        return; const ac = new AbortController(); try {
        ctx.registerTool({ name: "add_expense", title: "지출 기록", description: "우리장부에 지출을 기록합니다.", inputSchema: { type: "object", properties: { merchant: { type: "string" }, amount: { type: "number", minimum: 1 }, category: { type: "string", enum: categories } }, required: ["merchant", "amount", "category"], additionalProperties: false }, annotations: { readOnlyHint: false, untrustedContentHint: false, consequentialHint: false }, execute: (raw: unknown) => { const v = raw as {
                merchant?: string;
                amount?: number;
                category?: string;
            }; if (!v.merchant?.trim() || !v.amount || !categories.includes(v.category || ""))
                throw new Error("거래 정보가 올바르지 않습니다."); const row = { id: Date.now(), owner: nicknames.me, date: todayKey(), merchant: v.merchant.trim(), category: v.category!, account: "도구 입력", amount: -Math.abs(v.amount) }; setTxs(x => [row, ...x]); setActiveMonth(monthKey(row.date)); return { id: row.id, saved: true }; } }, { signal: ac.signal });
    }
    catch { } return () => ac.abort(); }, [nicknames.me]);
    const title = { dashboard: "가정 대시보드", transactions: "거래 내역", budget: "예산과 고정비", assets: "자산과 투자", settings: "가계부 설정" }[view];
    return <div className="min-h-screen bg-[#f4f7f9] text-[#14213a]"><Toaster position="top-center" richColors/>
    <aside className={`fixed inset-y-0 left-0 z-40 w-[244px] bg-[#10233d] text-white transition-transform lg:translate-x-0 ${menu ? "translate-x-0" : "-translate-x-full"}`}><div className="flex h-full flex-col px-4 py-5">
      <div className="flex items-center justify-between px-2"><button className="flex items-center gap-3" onClick={() => setView("dashboard")}><span className="grid size-10 place-items-center rounded-2xl bg-[#2bd8ac] text-[#08231d]"><WalletCards size={21}/></span><span className="text-xl font-extrabold tracking-[-.04em]">우리장부</span></button><button className="lg:hidden" onClick={() => setMenu(false)} aria-label="닫기"><X /></button></div>
      <div className="mt-8 rounded-2xl border border-white/10 bg-white/8 p-3"><div className="flex items-center gap-3"><div className="grid size-9 place-items-center rounded-full bg-[#d9fff4] font-bold text-[#145b49]">{nicknames.me.slice(0, 1)}</div><div><p className="text-sm font-semibold">{nicknames.me}</p><p className="text-xs text-white/55">개인 가계부</p></div></div><button className="mt-3 flex w-full items-center justify-between rounded-xl bg-white/8 px-3 py-2 text-sm"><span className="flex items-center gap-2"><Users size={16}/>우리 가족</span><ChevronDown size={15}/></button></div>
      <nav className="mt-7 space-y-1"><Nav icon={Gauge} label="대시보드" active={view === "dashboard"} onClick={() => setView("dashboard")}/><Nav icon={CreditCard} label="거래 내역" active={view === "transactions"} onClick={() => setView("transactions")}/><Nav icon={Target} label="예산·고정비" active={view === "budget"} onClick={() => setView("budget")}/><Nav icon={TrendingUp} label="자산·투자" active={view === "assets"} onClick={() => setView("assets")}/></nav>
      <div className="mt-auto border-t border-white/10 pt-4"><Nav icon={Settings} label="설정" active={view === "settings"} onClick={() => setView("settings")}/></div>
    </div></aside>{menu && <button className="fixed inset-0 z-30 bg-black/30 lg:hidden" onClick={() => setMenu(false)} aria-label="메뉴 닫기"/>}
    <main className="min-h-screen lg:ml-[244px]"><header className="sticky top-0 z-20 flex h-18 items-center justify-between border-b border-[#dce5e9] bg-white/90 px-4 backdrop-blur-xl sm:px-7"><div className="flex items-center gap-3"><Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMenu(true)}><Menu /></Button><div><p className="text-xs font-semibold text-[#2a8a72]">{monthLabel(activeMonth)}</p><h1 className="text-lg font-bold">{title}</h1></div></div><div className="flex items-center gap-2"><Button variant="outline" className="hidden sm:flex"><CalendarDays />{monthLabel(activeMonth)}</Button><Button variant="ghost" size="icon" aria-label="알림"><Bell /></Button><Button className="bg-[#173f69]" onClick={() => setView("settings")}><Users />{auth.user ? "계정" : "로그인"}</Button></div></header>
      <div className="mx-auto max-w-[1440px] p-4 pb-24 sm:p-7">{inviteCode && !auth.user && <section className="mb-5 flex flex-col gap-3 rounded-2xl border border-[#9bdccb] bg-[#eaf8f4] p-4 sm:flex-row sm:items-center sm:justify-between"><div><b>공유 장부 초대 링크입니다</b><p className="mt-1 text-sm text-[#466d61]">Google 로그인만 하면 장부 소유자에게 접속 권한을 요청합니다. 승인 전에는 장부 내용을 볼 수 없어요.</p></div><Button className="shrink-0" onClick={() => setView("settings")}>Google 로그인</Button></section>}{view === "dashboard" && <Dashboard totals={totals} txs={txs} activeMonth={activeMonth} budgetLimits={budgetLimits} assetSnapshot={dashboardAssets} add={() => setAdd(true)} upload={() => setUpload(true)} assets={() => setView("assets")} budget={() => setView("budget")} transactions={() => setView("transactions")} showGettingStarted={showGettingStarted} dismissGettingStarted={dismissGettingStarted}/>} {view === "transactions" && <Transactions txs={txs} upload={() => setUpload(true)} nicknames={nicknames} paymentBenefits={paymentBenefits} setPaymentBenefits={setPaymentBenefits} onUpdate={updateTransaction} onDelete={deleteTransaction}/>} {view === "budget" && <Budget txs={txs} activeMonth={activeMonth} budgetLimits={budgetLimits} setBudgetLimits={setBudgetLimits} savingsTarget={savingsTarget} setSavingsTarget={setSavingsTarget} fixedCosts={fixedCosts} setFixedCosts={setFixedCosts}/>} {view === "assets" && <Assets refreshing={refreshing} updated={updated} refresh={refresh} nicknames={nicknames} activeMonth={activeMonth} assetHistory={assetHistory} setAssetHistory={setAssetHistory}/>} {view === "settings" && <SettingsView nicknames={nicknames} onSave={setNicknames} onSignedIn={acceptGoogleAccount} onClearLocalOnlyData={clearLocalOnlyData}/>}</div>
    </main><nav className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-4 border-t bg-white px-2 py-2 lg:hidden">{[{ v: "dashboard", i: Home, l: "홈" }, { v: "transactions", i: CreditCard, l: "거래" }, { v: "budget", i: Target, l: "예산" }, { v: "assets", i: TrendingUp, l: "자산" }].map(({ v, i: I, l }) => <button key={v} onClick={() => setView(v as View)} className={`flex flex-col items-center gap-1 rounded-xl py-1.5 text-xs ${view === v ? "font-bold text-[#126f5a]" : "text-[#6d7d8b]"}`}><I size={19}/>{l}</button>)}</nav>
    <Dialog open={add} onOpenChange={setAdd}><DialogContent><DialogHeader><DialogTitle>지출 기록</DialogTitle><DialogDescription>이번 달 현황에 바로 반영됩니다.</DialogDescription></DialogHeader><div className="grid gap-4"><Label text="거래처"><Input value={merchant} onChange={e => setMerchant(e.target.value)} placeholder="예: 하나로마트"/></Label><Label text="금액"><Input inputMode="numeric" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0"/></Label><Label text="카테고리"><Select value={category} onValueChange={setCategory}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{categories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select></Label></div><DialogFooter><Button variant="outline" onClick={() => setAdd(false)}>취소</Button><Button onClick={save}>저장</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={upload} onOpenChange={setUpload}><DialogContent><DialogHeader><DialogTitle>거래 파일 가져오기</DialogTitle><DialogDescription>카드·은행 파일을 자동으로 분석하고, 처음 보는 양식만 열 연결을 요청합니다.</DialogDescription></DialogHeader><button onClick={() => fileRef.current?.click()} className="grid min-h-44 place-items-center rounded-2xl border-2 border-dashed border-[#9eb8c4] bg-[#f5fafb] p-6 text-center hover:border-[#23a988]"><span><Upload className="mx-auto mb-3 text-[#168469]"/><b className="block">파일을 선택하세요</b><span className="mt-1 block text-sm text-[#6d7d8b]">XLSX, CSV</span></span></button><input ref={fileRef} className="hidden" type="file" accept=".xlsx,.csv" onChange={e => importFile(e.target.files?.[0])}/><div className="rounded-xl bg-[#eef5ff] p-3 text-sm text-[#365773]">자동 인식되지 않는 파일은 날짜·거래처·금액 열만 한 번 확인하면 같은 양식을 다음부터 자동으로 가져옵니다.</div></DialogContent></Dialog>
    <Dialog open={!!manualImport} onOpenChange={open => { if (!open) {
        setManualImport(null);
        setManualMapping(null);
    } }}><DialogContent className="sm:max-w-xl"><DialogHeader><DialogTitle>거래 열 연결 확인</DialogTitle><DialogDescription>자동 인식되지 않은 양식입니다. 필수 열 세 개만 확인해주세요.</DialogDescription></DialogHeader>{manualImport && manualMapping && <div className="space-y-4"><div className="rounded-xl bg-[#f5f8fa] p-3 text-sm"><b className="block truncate">{manualImport.file.name}</b><span className="text-[#6d7d8b]">감지된 시트 · {manualImport.suggestion.sheetName}</span></div><div className="grid gap-3 sm:grid-cols-2"><MappingSelect label="날짜 열" value={manualMapping.dateCol} columns={manualImport.suggestion.columns} required onChange={dateCol => setManualMapping(old => old ? { ...old, dateCol: dateCol ?? -1 } : old)}/><MappingSelect label="거래처 열" value={manualMapping.merchantCol} columns={manualImport.suggestion.columns} required onChange={merchantCol => setManualMapping(old => old ? { ...old, merchantCol: merchantCol ?? -1 } : old)}/><MappingSelect label="금액 열" value={manualMapping.amountCol} columns={manualImport.suggestion.columns} required onChange={amountCol => setManualMapping(old => old ? { ...old, amountCol: amountCol ?? -1 } : old)}/><MappingSelect label="취소·상태 열" value={manualMapping.statusCol} columns={manualImport.suggestion.columns} onChange={statusCol => setManualMapping(old => old ? { ...old, statusCol } : old)}/><MappingSelect label="카드·계좌 열" value={manualMapping.accountCol} columns={manualImport.suggestion.columns} onChange={accountCol => setManualMapping(old => old ? { ...old, accountCol } : old)}/></div><div className="rounded-xl border border-[#bee3d8] bg-[#eaf8f4] p-3 text-sm text-[#35675a]">가져온 금액은 카드 지출로 처리하고, 취소·상태 열에 취소 표시가 있는 행은 제외합니다.</div></div>}<DialogFooter><Button variant="outline" onClick={() => { setManualImport(null); setManualMapping(null); }}>취소</Button><Button onClick={importWithManualMapping} disabled={!manualMapping || [manualMapping.dateCol, manualMapping.merchantCol, manualMapping.amountCol].some(column => column < 0)}>이 열로 가져오기</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={accessPromptOpen} onOpenChange={setAccessPromptOpen}><DialogContent><DialogHeader><DialogTitle>가계부 접속 승인 요청</DialogTitle><DialogDescription>가족이 공동 장부 접근을 요청했습니다. 승인하면 즉시 같은 장부를 함께 사용할 수 있습니다.</DialogDescription></DialogHeader><div className="space-y-3">{pendingAccessRequests.map(request => <div key={request.id} className="rounded-xl border bg-[#f5f8fa] p-4"><b>{request.name}</b><p className="mt-1 text-sm text-[#62757e]">{request.email}</p><div className="mt-3 flex gap-2"><Button size="sm" onClick={() => void handleAccessRequest(request.id, "approve")} disabled={handlingAccessRequest}>승인</Button><Button size="sm" variant="outline" onClick={() => void handleAccessRequest(request.id, "reject")} disabled={handlingAccessRequest}>거절</Button></div></div>)}</div><DialogFooter><Button variant="outline" onClick={() => setAccessPromptOpen(false)}>나중에 확인</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
function Dashboard({ totals: _, txs, activeMonth, budgetLimits, assetSnapshot, add, upload, assets, budget, transactions, showGettingStarted, dismissGettingStarted }: {
    totals: {
        income: number;
        expense: number;
    };
    txs: Tx[];
    activeMonth: string;
    budgetLimits: BudgetLimit[];
    assetSnapshot: AssetSnapshot;
    add: () => void;
    upload: () => void;
    assets: () => void;
    budget: () => void;
    transactions: () => void;
    showGettingStarted: boolean;
    dismissGettingStarted: () => void;
}) {
    const recentInputMonth = useMemo(() => txs.map(transaction => monthKey(transaction.date)).filter(month => /^\d{4}-\d{2}$/.test(month)).sort((a, b) => b.localeCompare(a))[0] || activeMonth, [txs, activeMonth]);
    const previousMonth = previousMonthKey(recentInputMonth);
    const income = txs.filter(transaction => monthKey(transaction.date) === recentInputMonth && transaction.amount > 0).reduce((sum, transaction) => sum + transaction.amount, 0);
    const expense = Math.abs(txs.filter(transaction => monthKey(transaction.date) === recentInputMonth && transaction.amount < 0).reduce((sum, transaction) => sum + transaction.amount, 0));
    const monthly = txs.filter(transaction => monthKey(transaction.date) === recentInputMonth && transaction.amount < 0);
    const previousExpense = Math.abs(txs.filter(transaction => monthKey(transaction.date) === previousMonth && transaction.amount < 0).reduce((sum, transaction) => sum + transaction.amount, 0));
    const previousDifference = previousExpense - expense;
    const previousExpenseNote = previousExpense === 0 ? `${monthLabel(previousMonth)} 기록 없음` : previousDifference === 0 ? `${monthLabel(recentInputMonth)}과 같아요` : previousDifference > 0 ? `${monthLabel(recentInputMonth)}보다 ${money(previousDifference)} 많아요` : `${monthLabel(recentInputMonth)}보다 ${money(previousDifference)} 적어요`;
    const budgetRows = budgetLimits.map(row => ({ name: row.category, used: monthly.filter(transaction => transaction.category === row.category).reduce((sum, transaction) => sum + Math.abs(transaction.amount), 0), limit: row.limit, color: row.color }));
    const cashAssets = assetSnapshot.savings.filter(row => row.currency === "KRW").reduce((sum, row) => sum + row.value, 0);
    const investmentAssets = assetSnapshot.holdings.filter(row => row.currency === "KRW").reduce((sum, row) => sum + row.value, 0);
    const debt = assetSnapshot.loans.reduce((sum, row) => sum + row.value, 0);
    const netAssets = cashAssets + investmentAssets - debt;
    const assetCount = assetSnapshot.savings.length + assetSnapshot.holdings.length + assetSnapshot.loans.length;
    const recentTransactions = [...txs].sort((a, b) => transactionDate(b.date).localeCompare(transactionDate(a.date))).slice(0, 5);
    return <div className="space-y-6">
    {showGettingStarted && <GettingStarted add={add} upload={upload} dismiss={dismissGettingStarted}/>}
    <section className="overflow-hidden rounded-[26px] bg-[#173f69] p-5 text-white shadow-[0_16px_45px_rgba(20,54,88,.18)] sm:p-7"><div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-end"><div><p className="text-sm text-white/60">우리 가족 순자산</p><p className="mt-2 text-3xl font-black tracking-[-.04em] sm:text-4xl">{signedMoney(netAssets)}</p><p className="mt-2 text-sm text-[#8be7cf]">{assetCount ? `${monthLabel(activeMonth)} 자산 기록 기준` : "자산을 등록하면 합산됩니다."}</p></div><div className="grid grid-cols-2 gap-2"><Button variant="secondary" onClick={add}><Plus />직접 입력</Button><Button className="bg-[#2bd8ac] text-[#08231d] hover:bg-[#4ce3bd]" onClick={upload}><FileSpreadsheet />파일 가져오기</Button></div></div><div className="mt-7 grid gap-3 border-t border-white/12 pt-5 sm:grid-cols-3"><Mini label="현금성 자산" value={assetMoney(cashAssets)}/><Mini label="투자자산" value={assetMoney(investmentAssets)}/><Mini label="부채·카드" value={signedMoney(-debt)}/></div></section>
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Metric icon={ArrowDownLeft} label={`${monthLabel(recentInputMonth)} 수입`} value={money(income)} note="최근 입력월 거래 기준" tone="mint"/><Metric icon={ArrowUpRight} label={`${monthLabel(recentInputMonth)} 지출`} value={money(expense)} note="최근 입력월 거래 기준" tone="blue"/><Metric icon={PiggyBank} label="예상 저축" value={signedMoney(income - expense)} note={`${monthLabel(recentInputMonth)} 수입 - 지출`} tone="amber"/><Metric icon={CalendarDays} label={`${monthLabel(previousMonth)} 지출`} value={money(previousExpense)} note={previousExpenseNote} tone="rose"/></section>
    <section className="grid gap-5 xl:grid-cols-[1.5fr_1fr]"><Panel title="예산 사용 현황" action="예산 보기" onAction={budget}><BudgetBars rows={budgetRows}/></Panel><Panel title="자산 구성" action="자산 보기" onAction={assets}>{assetCount ? <div className="space-y-3"><AssetMixRow label="예금·현금" value={cashAssets} total={cashAssets + investmentAssets}/><AssetMixRow label="주식·ETF" value={investmentAssets} total={cashAssets + investmentAssets}/><div className="flex items-center justify-between border-t pt-3 text-sm"><span className="text-[#6d7d8b]">대출·부채</span><b>{signedMoney(-debt)}</b></div></div> : <EmptyState title="등록된 자산이 없어요" description="자산·투자에서 첫 자산을 추가해보세요."/>}</Panel></section>
    <section className="grid gap-5 xl:grid-cols-[1.5fr_1fr]"><Panel title="최근 거래" action="전체 보기" onAction={transactions}><TxTable txs={recentTransactions}/></Panel><Panel title={`${monthLabel(recentInputMonth)} 항목별 지출`} action="거래 보기" onAction={transactions}><CategorySpending transactions={txs} activeMonth={recentInputMonth}/></Panel></section>
  </div>;
}
function CategorySpending({ transactions, activeMonth }: {
    transactions: Tx[];
    activeMonth: string;
}) {
    const previousMonth = previousMonthKey(activeMonth);
    const currentTransactions = transactions.filter(row => row.amount < 0 && monthKey(row.date) === activeMonth);
    const previousTransactions = transactions.filter(row => row.amount < 0 && monthKey(row.date) === previousMonth);
    const total = currentTransactions.reduce((sum, row) => sum + Math.abs(row.amount), 0);
    const ranked = categories.map((name, index) => ({ name, amount: currentTransactions.filter(row => row.category === name).reduce((sum, row) => sum + Math.abs(row.amount), 0), previous: previousTransactions.filter(row => row.category === name).reduce((sum, row) => sum + Math.abs(row.amount), 0), color: categoryColors[index % categoryColors.length] })).filter(row => row.amount > 0).sort((a, b) => b.amount - a.amount);
    if (!ranked.length)
        return <EmptyState title={`${monthLabel(activeMonth)} 지출이 없어요`} description="거래를 등록하면 항목별 비중을 보여드려요."/>;
    const main = ranked.slice(0, 5);
    const remaining = ranked.slice(5);
    const remainder = remaining.reduce((sum, row) => sum + row.amount, 0);
    const rows = remainder ? [...main, { name: "그 외", amount: remainder, previous: remaining.reduce((sum, row) => sum + row.previous, 0), color: "#aab7bf" }] : main;
    let current = 0;
    const gradient = rows.map(row => { const start = current; current += row.amount / total * 100; return `${row.color} ${start}% ${current}%`; }).join(",");
    return <div className="grid gap-5 sm:grid-cols-[150px_1fr] sm:items-center"><div className="relative mx-auto size-36 rounded-full" role="img" aria-label={`${monthLabel(activeMonth)} 총지출 ${money(total)}의 항목별 비중`} style={{ background: `conic-gradient(${gradient})` }}><div className="absolute inset-[22px] grid place-items-center rounded-full bg-white text-center shadow-[inset_0_0_0_1px_#edf1f3]"><span><small className="block text-[#74838d]">{monthLabel(activeMonth)}</small><b className="mt-1 block text-sm">{money(total)}</b></span></div></div><div className="space-y-2.5">{rows.map(row => { const change = row.previous ? (row.amount - row.previous) / row.previous * 100 : null; const changeTone = change === null || change === 0 ? "text-[#89969e]" : change > 0 ? "text-[#c94958]" : "text-[#168469]"; return <div key={row.name} className="grid grid-cols-[auto_1fr_auto] items-center gap-2 text-sm"><span className="size-2.5 rounded-full" style={{ background: row.color }}/><span className="truncate text-[#5f707b]">{row.name}</span><span className="text-right"><span className="block"><b>{money(row.amount)}</b><small className="ml-1 text-[#89969e]">{Math.round(row.amount / total * 100)}%</small></span><small className={changeTone}>지난달 기록 대비 {change === null ? "기록 없음" : `${change > 0 ? "+" : ""}${Math.round(change)}%`}</small></span></div>; })}</div></div>;
}
function Transactions({ txs, upload, nicknames, paymentBenefits, setPaymentBenefits, onUpdate, onDelete }: {
    txs: Tx[];
    upload: () => void;
    nicknames: {
        me: string;
        partner: string;
    };
    paymentBenefits: Record<string, PaymentBenefit>;
    setPaymentBenefits: Dispatch<SetStateAction<Record<string, PaymentBenefit>>>;
    onUpdate: (transaction: Tx) => void;
    onDelete: (id: number) => void;
}) {
    const [search, setSearch] = useState("");
    const [monthFilter, setMonthFilter] = useState("all");
    const [ownerFilter, setOwnerFilter] = useState("all");
    const [accountFilter, setAccountFilter] = useState("all");
    const [kindFilter, setKindFilter] = useState<"all" | "income" | "expense">("all");
    const [downloading, setDownloading] = useState(false);
    const [editing, setEditing] = useState<Tx | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<Tx | null>(null);
    const [editForm, setEditForm] = useState<{
        owner: string;
        date: string;
        merchant: string;
        category: string;
        account: string;
        kind: "expense" | "income";
        amount: string;
    }>({ owner: "", date: "", merchant: "", category: "식비", account: "", kind: "expense", amount: "" });
    const [benefitEditorOpen, setBenefitEditorOpen] = useState(false);
    const [benefitAccount, setBenefitAccount] = useState("");
    const [benefitTarget, setBenefitTarget] = useState("");
    const [benefitDescription, setBenefitDescription] = useState("");
    const safePaymentBenefits = normalizePaymentBenefits(paymentBenefits);
    const accounts = useMemo(() => Array.from(new Set(txs.map(t => t.account))).sort((a, b) => a.localeCompare(b, "ko")), [txs]);
    const availableMonths = useMemo(() => Array.from(new Set(txs.map(t => monthKey(t.date)))).sort((a, b) => b.localeCompare(a)), [txs]);
    const filtered = useMemo(() => { const q = search.trim().toLocaleLowerCase("ko"); return txs.filter(t => (!q || [t.merchant, t.category, t.account, t.owner].some(v => v.toLocaleLowerCase("ko").includes(q))) && (monthFilter === "all" || monthKey(t.date) === monthFilter) && (ownerFilter === "all" || t.owner === ownerFilter) && (accountFilter === "all" || t.account === accountFilter) && (kindFilter === "all" || (kindFilter === "income" && t.amount > 0) || (kindFilter === "expense" && t.amount < 0))).sort((a, b) => transactionDate(b.date).localeCompare(transactionDate(a.date))); }, [txs, search, monthFilter, ownerFilter, accountFilter, kindFilter]);
    const accountSpending = useMemo(() => Array.from(filtered.filter(t => t.amount < 0).reduce((totals, t) => totals.set(t.account, (totals.get(t.account) || 0) + Math.abs(t.amount)), new Map<string, number>())).map(([account, total]) => ({ account, total })).sort((a, b) => b.total - a.total), [filtered]);
    const configuredCards = useMemo(() => Object.entries(safePaymentBenefits).map(([account, setting]) => ({ account, setting, total: accountSpending.find(row => row.account === account)?.total || 0 })).sort((a, b) => b.total - a.total), [safePaymentBenefits, accountSpending]);
    const filterDescription = monthFilter === "all" && ownerFilter === "all" && accountFilter === "all" && !search.trim() ? "전체 거래 기준" : "현재 필터 기준";
    const exportTransactions = async () => { const notice = toast.loading("현재 거래를 엑셀 양식에 담는 중"); setDownloading(true); try {
        await downloadTransactionTemplate(txs);
        toast.success(`${txs.length}건이 담긴 거래 양식을 내려받았습니다.`, { id: notice });
    }
    catch (error) {
        toast.error("거래 양식을 만들지 못했습니다.", { id: notice, description: error instanceof Error ? error.message : "잠시 후 다시 시도해주세요." });
    }
    finally {
        setDownloading(false);
    } };
    const startEdit = (transaction: Tx) => { setEditing(transaction); setEditForm({ owner: transaction.owner, date: transactionDate(transaction.date), merchant: transaction.merchant, category: transaction.category, account: transaction.account, kind: transaction.amount >= 0 ? "income" : "expense", amount: String(Math.abs(transaction.amount)) }); };
    const saveEdit = () => { if (!editing)
        return; const amount = Number(editForm.amount.replace(/[^0-9.-]/g, "")); if (!editForm.merchant.trim() || !amount) {
        toast.error("거래처와 금액을 입력해주세요.");
        return;
    } onUpdate({ ...editing, owner: editForm.owner || nicknames.me, date: editForm.date, merchant: editForm.merchant.trim(), category: editForm.category, account: editForm.account.trim() || "직접 입력", amount: editForm.kind === "income" ? Math.abs(amount) : -Math.abs(amount) }); setEditing(null); };
    const loadBenefitForm = (account: string) => { const current = safePaymentBenefits[account]; setBenefitAccount(account); setBenefitTarget(current?.target ? String(current.target) : ""); setBenefitDescription(current?.benefit || ""); };
    const openBenefitEditor = (account: string) => { loadBenefitForm(account); setBenefitEditorOpen(true); };
    const openBenefitCreator = () => { const account = accounts.find(item => !paymentBenefits[item]) || accounts[0] || ""; loadBenefitForm(account); setBenefitEditorOpen(true); };
    const saveBenefit = () => { if (!benefitAccount) {
        toast.error("결제수단을 선택해주세요.");
        return;
    } const target = Number(benefitTarget.replace(/[^0-9]/g, "")); if (!target) {
        toast.error("목표 사용액을 입력해주세요.");
        return;
    } setPaymentBenefits(current => ({ ...current, [benefitAccount]: { target, benefit: benefitDescription.trim() } })); setBenefitEditorOpen(false); toast.success(`${benefitAccount} 혜택 기준을 저장했습니다.`); };
    const deleteBenefit = () => { if (!benefitAccount)
        return; setPaymentBenefits(current => { const next = { ...current }; delete next[benefitAccount]; return next; }); setBenefitEditorOpen(false); toast.success("혜택 설정을 삭제했습니다."); };
    const clearFilters = () => { setSearch(""); setMonthFilter("all"); setOwnerFilter("all"); setAccountFilter("all"); setKindFilter("all"); };
    return <div className="space-y-5"><div className="flex flex-col justify-between gap-3 xl:flex-row xl:items-center"><div><h2 className="text-2xl font-black">{monthFilter === "all" ? "전체 거래" : `${monthLabel(monthFilter)} 거래`}</h2><p className="text-sm text-[#6d7d8b]">자동 분류 마스터가 포함된 엑셀 양식을 내려받아 수정한 뒤 다시 올릴 수 있습니다.</p></div><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={exportTransactions} disabled={downloading}><Download />{downloading ? "양식 만드는 중" : "거래 양식 다운로드"}</Button><Button variant="outline" onClick={upload}><Upload />작성한 파일 업로드</Button></div></div>
    <section className="grid gap-3 rounded-2xl border border-[#bee3d8] bg-[#eaf8f4] p-4 text-sm text-[#35675a] sm:grid-cols-3"><div><b className="block text-[#1d6654]">1. 현재 내용 내려받기</b><span>날짜 오름차순으로 현재 거래가 자동으로 채워집니다.</span></div><div><b className="block text-[#1d6654]">2. 엑셀에서 수정</b><span>거래처를 입력하면 분류마스터 규칙으로 분류가 자동 입력됩니다.</span></div><div><b className="block text-[#1d6654]">3. 다시 업로드</b><span>허용된 분류만 반영하고 거래 목록 전체를 갱신해 중복을 막습니다.</span></div></section>
    <section className="rounded-2xl border bg-white p-4 shadow-[0_8px_24px_rgba(20,54,88,.035)] sm:p-5"><div className="mb-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div><h2 className="font-extrabold">혜택 카드 사용 현황</h2><p className="mt-1 text-sm text-[#6d7d8b]">직접 지정한 카드만 {filterDescription}의 사용액과 목표 달성률을 보여드려요.</p></div><Button variant="outline" size="sm" onClick={openBenefitCreator} disabled={!accounts.length}><Plus />혜택 카드 추가</Button></div>{monthFilter === "all" && configuredCards.length > 0 && <div className="mb-4 rounded-xl bg-[#fff7e5] px-3 py-2 text-sm text-[#8a6217]">카드 혜택 목표는 보통 월 단위예요. 월 필터를 선택하면 해당 월의 정확한 달성률을 볼 수 있습니다.</div>}{configuredCards.length ? <div className="grid gap-4 lg:grid-cols-2">{configuredCards.map(({ account, total, setting }, index) => { const rate = total / setting.target * 100; const remaining = Math.max(0, setting.target - total); const cardColors = index % 3 === 0 ? "from-[#173f69] to-[#2a6990]" : index % 3 === 1 ? "from-[#185d52] to-[#2d9a7e]" : "from-[#55467f] to-[#826da8]"; return <article key={account} className="rounded-2xl border border-[#e2e9ec] bg-[#f8fafb] p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-sm text-[#6d7d8b]">현재 사용액</p><b className="mt-1 block text-xl">{money(total)}</b></div><Button variant="outline" size="sm" onClick={() => openBenefitEditor(account)}>혜택 수정</Button></div><div className="mt-4"><div className="mb-2 flex items-end justify-between gap-3 text-sm"><span className="font-semibold text-[#53646f]">목표 {money(setting.target)}</span><b className={rate >= 100 ? "text-[#168469]" : "text-[#315f8d]"}>{Math.round(rate)}%</b></div><Progress value={Math.min(100, rate)} className="h-2.5 [&_[data-slot=progress-indicator]]:bg-[#2a9d81]"/><p className="mt-2 text-xs text-[#74838d]">{rate >= 100 ? "이번 기준의 목표 사용액을 달성했어요." : `${money(remaining)} 더 사용하면 목표를 달성해요.`}</p></div><div className={`relative mt-4 min-h-36 overflow-hidden rounded-[20px] bg-gradient-to-br ${cardColors} p-5 text-white shadow-[0_14px_28px_rgba(23,63,105,.18)]`}><div className="absolute -right-8 -top-10 size-32 rounded-full bg-white/10"/><div className="relative flex h-full flex-col justify-between gap-8"><div className="flex items-center justify-between"><CreditCard size={24}/><span className="text-xs font-semibold tracking-[.18em] text-white/65">BENEFIT CARD</span></div><div><p className="truncate font-bold" title={account}>{account}</p><p className="mt-1 line-clamp-2 text-sm text-white/72">{setting.benefit || "등록된 혜택 설명이 없습니다."}</p></div></div></div></article>; })}</div> : <div className="rounded-2xl border border-dashed border-[#cbd7dc] bg-[#f8fafb] py-9 text-center"><CreditCard className="mx-auto mb-2 text-[#8a98a2]"/><b>표시할 혜택 카드가 없어요</b><p className="mt-1 text-sm text-[#74838d]">혜택이 있는 카드만 선택해 목표 사용액을 관리해보세요.</p><Button className="mt-4" size="sm" onClick={openBenefitCreator} disabled={!accounts.length}><Plus />첫 혜택 카드 추가</Button></div>}</section>
    <Panel title={`전체 거래 · ${filtered.length}건`} action="필터 초기화" onAction={clearFilters}><div className="mb-4 grid gap-2 md:grid-cols-2 2xl:grid-cols-[minmax(240px,1fr)_150px_150px_160px_190px]"><div className="relative"><Search className="absolute left-3 top-2.5 size-4 text-[#7c8b96]"/><Input value={search} onChange={e => setSearch(e.target.value)} className="pl-9" placeholder="거래처·분류·계좌 검색"/></div><Select value={monthFilter} onValueChange={setMonthFilter}><SelectTrigger className="w-full" aria-label="거래 월"><SelectValue placeholder="전체 기간"/></SelectTrigger><SelectContent><SelectItem value="all">전체 기간</SelectItem>{availableMonths.map(month => <SelectItem key={month} value={month}>{monthLabel(month)}</SelectItem>)}</SelectContent></Select><Select value={kindFilter} onValueChange={(value: "all" | "income" | "expense") => setKindFilter(value)}><SelectTrigger className="w-full"><SelectValue placeholder="수입·지출"/></SelectTrigger><SelectContent><SelectItem value="all">수입·지출 전체</SelectItem><SelectItem value="income">수입</SelectItem><SelectItem value="expense">지출</SelectItem></SelectContent></Select><Select value={ownerFilter} onValueChange={setOwnerFilter}><SelectTrigger className="w-full"><SelectValue placeholder="전체 작성자"/></SelectTrigger><SelectContent><SelectItem value="all">전체 작성자</SelectItem><SelectItem value={nicknames.me}>{nicknames.me}</SelectItem><SelectItem value={nicknames.partner}>{nicknames.partner}</SelectItem></SelectContent></Select><Select value={accountFilter} onValueChange={setAccountFilter}><SelectTrigger className="w-full"><SelectValue placeholder="전체 계좌·카드"/></SelectTrigger><SelectContent><SelectItem value="all">전체 계좌·카드</SelectItem>{accounts.map(account => <SelectItem key={account} value={account}>{account}</SelectItem>)}</SelectContent></Select></div>{filtered.length ? <><TransactionTotal txs={filtered}/><TxTable txs={filtered} onEdit={startEdit} onDelete={setDeleteTarget}/></> : <div className="rounded-2xl bg-[#f5f8fa] py-12 text-center"><Search className="mx-auto mb-3 text-[#8a98a2]"/><b>조건에 맞는 거래가 없어요</b><p className="mt-1 text-sm text-[#74838d]">검색어나 월별 필터를 바꿔보세요.</p></div>}</Panel>
    <Dialog open={!!editing} onOpenChange={next => { if (!next)
        setEditing(null); }}><DialogContent><DialogHeader><DialogTitle>거래 내용 수정</DialogTitle><DialogDescription>저장하면 거래 목록과 이번 달 합계에 바로 반영됩니다.</DialogDescription></DialogHeader><div className="grid gap-4 sm:grid-cols-2"><Label text="작성자"><Select value={editForm.owner} onValueChange={owner => setEditForm(old => ({ ...old, owner }))}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{![nicknames.me, nicknames.partner].includes(editForm.owner) && editForm.owner && <SelectItem value={editForm.owner}>{editForm.owner}</SelectItem>}<SelectItem value={nicknames.me}>{nicknames.me}</SelectItem><SelectItem value={nicknames.partner}>{nicknames.partner}</SelectItem></SelectContent></Select></Label><Label text="거래일"><Input type="date" value={editForm.date} onChange={e => setEditForm(old => ({ ...old, date: e.target.value }))}/></Label><Label text="거래처·내용"><Input value={editForm.merchant} onChange={e => setEditForm(old => ({ ...old, merchant: e.target.value }))}/></Label><Label text="분류"><Select value={editForm.category} onValueChange={category => setEditForm(old => ({ ...old, category }))}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{!categories.includes(editForm.category) && editForm.category && <SelectItem value={editForm.category}>{editForm.category}</SelectItem>}{categories.map(item => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select></Label><Label text="계좌·카드"><Input value={editForm.account} onChange={e => setEditForm(old => ({ ...old, account: e.target.value }))}/></Label><Label text="구분"><Select value={editForm.kind} onValueChange={(kind: "expense" | "income") => setEditForm(old => ({ ...old, kind }))}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="expense">지출</SelectItem><SelectItem value="income">수입</SelectItem></SelectContent></Select></Label><Label text="금액"><Input inputMode="numeric" value={editForm.amount} onChange={e => setEditForm(old => ({ ...old, amount: e.target.value }))}/></Label></div><DialogFooter><Button variant="outline" onClick={() => setEditing(null)}>취소</Button><Button onClick={saveEdit}>수정 내용 저장</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={benefitEditorOpen} onOpenChange={setBenefitEditorOpen}><DialogContent><DialogHeader><DialogTitle>혜택 카드 설정</DialogTitle><DialogDescription>표시할 결제수단과 월 목표 사용액, 주요 혜택을 입력해주세요.</DialogDescription></DialogHeader><div className="grid gap-4"><Label text="결제수단"><Select value={benefitAccount} onValueChange={loadBenefitForm}><SelectTrigger className="w-full"><SelectValue placeholder="결제수단 선택"/></SelectTrigger><SelectContent>{benefitAccount && !accounts.includes(benefitAccount) && <SelectItem value={benefitAccount}>{benefitAccount}</SelectItem>}{accounts.map(account => <SelectItem key={account} value={account}>{account}</SelectItem>)}</SelectContent></Select></Label><Label text="목표 사용액"><Input inputMode="numeric" value={benefitTarget} onChange={e => setBenefitTarget(e.target.value)} placeholder="예: 500000"/></Label><Label text="카드 혜택"><Textarea value={benefitDescription} onChange={e => setBenefitDescription(e.target.value)} placeholder="예: 월 50만원 이상 사용 시 주유 5% 할인, 통신비 1만원 할인" rows={4}/></Label></div><DialogFooter>{benefitAccount && safePaymentBenefits[benefitAccount] && <Button variant="outline" className="mr-auto text-[#c94958]" onClick={deleteBenefit}>설정 삭제</Button>}<Button variant="outline" onClick={() => setBenefitEditorOpen(false)}>취소</Button><Button onClick={saveBenefit}>혜택 기준 저장</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={!!deleteTarget} onOpenChange={next => { if (!next)
        setDeleteTarget(null); }}><DialogContent><DialogHeader><DialogTitle>거래를 삭제할까요?</DialogTitle><DialogDescription>{deleteTarget?.merchant} 거래가 목록과 합계에서 제거됩니다.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setDeleteTarget(null)}>취소</Button><Button className="bg-[#c94958] hover:bg-[#b83d4b]" onClick={() => { if (deleteTarget)
        onDelete(deleteTarget.id); setDeleteTarget(null); }}>삭제</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
function Budget({ txs, activeMonth, budgetLimits, setBudgetLimits, savingsTarget, setSavingsTarget, fixedCosts, setFixedCosts }: {
    txs: Tx[];
    activeMonth: string;
    budgetLimits: BudgetLimit[];
    setBudgetLimits: (rows: BudgetLimit[]) => void;
    savingsTarget: number;
    setSavingsTarget: (value: number) => void;
    fixedCosts: FixedCost[];
    setFixedCosts: (rows: FixedCost[]) => void;
}) {
    const activeYear = Number(activeMonth.slice(0, 4));
    const activeMonthNumber = Number(activeMonth.slice(5, 7));
    const [selectedYear, setSelectedYear] = useState(activeYear);
    const [selectedMonth, setSelectedMonth] = useState(activeMonthNumber);
    const [startMonth, setStartMonth] = useState(Math.max(1, activeMonthNumber - 3));
    const [endMonth, setEndMonth] = useState(activeMonthNumber);
    const [budgetOpen, setBudgetOpen] = useState(false);
    const [budgetCategory, setBudgetCategory] = useState("식비");
    const [budgetAmount, setBudgetAmount] = useState("");
    const [goalOpen, setGoalOpen] = useState(false);
    const [goalAmount, setGoalAmount] = useState("");
    const [fixedOpen, setFixedOpen] = useState(false);
    const [fixedName, setFixedName] = useState("");
    const [fixedAmount, setFixedAmount] = useState("");
    const [fixedDay, setFixedDay] = useState("");
    useEffect(() => { setSelectedYear(activeYear); setSelectedMonth(activeMonthNumber); setStartMonth(Math.max(1, activeMonthNumber - 3)); setEndMonth(activeMonthNumber); }, [activeYear, activeMonthNumber]);
    const years = useMemo(() => Array.from(new Set([activeYear, ...txs.map(t => Number(monthKey(t.date).slice(0, 4)))])).sort((a, b) => b - a), [txs, activeYear]);
    const selectedKey = `${selectedYear}-${String(selectedMonth).padStart(2, "0")}`;
    const selectedTransactions = txs.filter(t => monthKey(t.date) === selectedKey);
    const monthly = selectedTransactions.filter(t => t.amount < 0);
    const totalUsed = monthly.reduce((sum, t) => sum + Math.abs(t.amount), 0);
    const monthlyIncome = selectedTransactions.filter(t => t.amount > 0).reduce((sum, t) => sum + t.amount, 0);
    const monthlySavings = monthlyIncome - totalUsed;
    const totalLimit = budgetLimits.reduce((sum, row) => sum + row.limit, 0);
    const monthlyBudgetRows = budgetLimits.map(row => ({ name: row.category, used: monthly.filter(transaction => transaction.category === row.category).reduce((sum, transaction) => sum + Math.abs(transaction.amount), 0), limit: row.limit, color: row.color }));
    const fixedTotal = fixedCosts.reduce((sum, row) => sum + row.amount, 0);
    const goalRate = savingsTarget ? Math.max(0, Math.min(100, monthlySavings / savingsTarget * 100)) : 0;
    const rangeStart = Math.min(startMonth, endMonth);
    const rangeEnd = Math.max(startMonth, endMonth);
    const chartData = Array.from({ length: rangeEnd - rangeStart + 1 }, (_, index) => { const month = rangeStart + index; const key = `${selectedYear}-${String(month).padStart(2, "0")}`; const row: Record<string, string | number> = { month: `${month}월` }; transactionCategories.filter(category => category !== "급여").forEach(category => { row[category] = txs.filter(t => monthKey(t.date) === key && t.amount < 0 && t.category === category).reduce((sum, t) => sum + Math.abs(t.amount), 0); }); return row; });
    const chartCategories = transactionCategories.filter(category => category !== "급여" && chartData.some(row => Number(row[category]) > 0));
    const openBudgetEditor = () => { const current = budgetLimits[0]; setBudgetCategory(current?.category || "식비"); setBudgetAmount(current ? String(current.limit) : ""); setBudgetOpen(true); };
    const selectBudgetCategory = (category: string) => { setBudgetCategory(category); setBudgetAmount(String(budgetLimits.find(row => row.category === category)?.limit || "")); };
    const saveBudget = () => { const limit = Number(budgetAmount.replace(/[^0-9]/g, "")); if (!limit) {
        toast.error("예산 금액을 입력해주세요.");
        return;
    } const current = budgetLimits.find(row => row.category === budgetCategory); const color = current?.color || categoryColors[Math.max(0, transactionCategories.indexOf(budgetCategory)) % categoryColors.length]; setBudgetLimits(current ? budgetLimits.map(row => row.category === budgetCategory ? { ...row, limit } : row) : [...budgetLimits, { category: budgetCategory, limit, color }]); setBudgetOpen(false); toast.success(`${budgetCategory} 예산을 저장했습니다.`); };
    const deleteBudget = () => { if (!budgetLimits.some(row => row.category === budgetCategory))
        return; setBudgetLimits(budgetLimits.filter(row => row.category !== budgetCategory)); setBudgetOpen(false); toast.success(`${budgetCategory} 예산을 삭제했습니다.`); };
    const saveGoal = () => { const target = Number(goalAmount.replace(/[^0-9]/g, "")); if (!target) {
        toast.error("저축 목표 금액을 입력해주세요.");
        return;
    } setSavingsTarget(target); setGoalOpen(false); toast.success("저축 목표를 저장했습니다."); };
    const addFixedCost = () => { const amount = Number(fixedAmount.replace(/[^0-9]/g, "")); const day = Number(fixedDay.replace(/[^0-9]/g, "")); if (!fixedName.trim() || !amount || day < 1 || day > 31) {
        toast.error("고정비 이름, 금액, 결제일을 확인해주세요.");
        return;
    } setFixedCosts([...fixedCosts, { id: Date.now(), name: fixedName.trim(), amount, day }]); setFixedName(""); setFixedAmount(""); setFixedDay(""); toast.success("고정비를 추가했습니다."); };
    return <div className="space-y-5"><section className="flex flex-col justify-between gap-3 rounded-2xl border bg-white p-4 sm:flex-row sm:items-end sm:p-5"><div><p className="text-sm font-semibold text-[#287b67]">조회 기준</p><h2 className="mt-1 text-2xl font-black">{selectedYear}년 {selectedMonth}월 예산</h2><p className="text-sm text-[#6d7d8b]">월별 예산과 선택 기간의 분류별 사용액을 함께 확인합니다.</p></div><div className="grid grid-cols-2 gap-2"><Select value={String(selectedYear)} onValueChange={value => setSelectedYear(Number(value))}><SelectTrigger aria-label="예산 연도"><SelectValue /></SelectTrigger><SelectContent>{years.map(year => <SelectItem key={year} value={String(year)}>{year}년</SelectItem>)}</SelectContent></Select><Select value={String(selectedMonth)} onValueChange={value => setSelectedMonth(Number(value))}><SelectTrigger aria-label="예산 월"><SelectValue /></SelectTrigger><SelectContent>{Array.from({ length: 12 }, (_, index) => index + 1).map(month => <SelectItem key={month} value={String(month)}>{month}월</SelectItem>)}</SelectContent></Select></div></section>
    <div className="grid gap-5 xl:grid-cols-[1.2fr_.8fr]"><Panel title={`${selectedMonth}월 생활비 예산`} action="예산 수정" onAction={openBudgetEditor}><div className="mb-6 rounded-2xl bg-[#173f69] p-5 text-white"><div className="flex flex-wrap justify-between gap-2"><span className="text-white/65">전체 사용액</span><b>{money(totalUsed)} / {money(totalLimit)}</b></div><Progress className="mt-4 bg-white/15 [&_[data-slot=progress-indicator]]:bg-[#2bd8ac]" value={totalLimit ? Math.min(100, totalUsed / totalLimit * 100) : 0}/><p className="mt-3 text-sm text-white/65">{totalLimit ? (totalUsed <= totalLimit ? `${money(totalLimit - totalUsed)} 남았어요` : `${money(totalUsed - totalLimit)} 초과했어요`) : "설정된 생활비 예산이 없어요"}</p></div><BudgetBars rows={monthlyBudgetRows}/></Panel><div className="space-y-5"><Panel title="저축 목표" action="목표 수정" onAction={() => { setGoalAmount(savingsTarget ? String(savingsTarget) : ""); setGoalOpen(true); }}>{savingsTarget ? <div className="text-center"><div className="mx-auto grid size-32 place-items-center rounded-full p-3" style={{ background: `conic-gradient(#2bd8ac ${goalRate}%,#e7eef0 0)` }}><div className="grid size-full place-items-center rounded-full bg-white"><span><b className="block text-2xl">{Math.round(goalRate)}%</b><small className="text-[#6d7d8b]">달성</small></span></div></div><p className="mt-4 font-bold">{signedMoney(monthlySavings)}</p><p className="text-sm text-[#6d7d8b]">목표 {money(savingsTarget)}</p></div> : <EmptyState title="설정된 저축 목표가 없어요" description="목표를 정하면 달성률을 보여드려요."/>}</Panel><Panel title="고정비" action="관리" onAction={() => setFixedOpen(true)}><p className="text-3xl font-black">{money(fixedTotal)}</p><p className="mt-1 text-sm text-[#6d7d8b]">{fixedCosts.length ? `${fixedCosts.length}개 항목 · ${selectedMonth}월 예상액` : "등록된 고정비 없음"}</p></Panel></div></div>
    <Panel title={`${selectedYear}년 ${rangeStart}월–${rangeEnd}월 총 사용액`} action="기간별 분류 구성"><div className="mb-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><p className="max-w-2xl text-sm text-[#6d7d8b]">막대 한 개가 한 달의 총지출이며, 색상별 길이로 각 분류가 차지한 금액과 비율을 비교할 수 있습니다.</p><div className="grid grid-cols-2 gap-2"><Select value={String(startMonth)} onValueChange={value => setStartMonth(Number(value))}><SelectTrigger aria-label="기간 시작 월"><SelectValue /></SelectTrigger><SelectContent>{Array.from({ length: 12 }, (_, index) => index + 1).map(month => <SelectItem key={month} value={String(month)}>{month}월부터</SelectItem>)}</SelectContent></Select><Select value={String(endMonth)} onValueChange={value => setEndMonth(Number(value))}><SelectTrigger aria-label="기간 종료 월"><SelectValue /></SelectTrigger><SelectContent>{Array.from({ length: 12 }, (_, index) => index + 1).map(month => <SelectItem key={month} value={String(month)}>{month}월까지</SelectItem>)}</SelectContent></Select></div></div>{chartCategories.length ? <div className="h-[360px] w-full"><ResponsiveContainer width="100%" height="100%"><BarChart data={chartData} margin={{ top: 10, right: 12, left: 4, bottom: 0 }}><CartesianGrid stroke="#e5ecef" vertical={false}/><XAxis dataKey="month" tickLine={false} axisLine={false}/><YAxis tickFormatter={value => `${Math.round(Number(value) / 10000)}만`} tickLine={false} axisLine={false} width={48}/><Tooltip formatter={value => `${Number(value).toLocaleString("ko-KR")}원`}/><ChartLegend wrapperStyle={{ fontSize: 12 }}/>{chartCategories.map((category, index) => <Bar key={category} dataKey={category} stackId="expenses" fill={categoryColors[index % categoryColors.length]}/>)}</BarChart></ResponsiveContainer></div> : <div className="rounded-2xl bg-[#f5f8fa] py-14 text-center"><b>선택한 기간에 지출 거래가 없어요</b><p className="mt-1 text-sm text-[#74838d]">기간을 바꾸거나 거래 파일을 추가해보세요.</p></div>}</Panel>
    <Dialog open={budgetOpen} onOpenChange={setBudgetOpen}><DialogContent><DialogHeader><DialogTitle>분류별 예산 수정</DialogTitle><DialogDescription>분류를 고르고 한 달 예산을 입력하세요. 기존 분류를 선택하면 금액을 변경할 수 있습니다.</DialogDescription></DialogHeader><div className="grid gap-4"><Label text="분류"><Select value={budgetCategory} onValueChange={selectBudgetCategory}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{transactionCategories.filter(category => category !== "급여").map(category => <SelectItem key={category} value={category}>{category}</SelectItem>)}</SelectContent></Select></Label><Label text="월 예산"><Input inputMode="numeric" value={budgetAmount} onChange={event => setBudgetAmount(event.target.value)} placeholder="0"/></Label>{budgetLimits.length > 0 && <div className="rounded-xl bg-[#f5f8fa] p-3 text-sm text-[#637581]">현재 설정 · {budgetLimits.map(row => `${row.category} ${money(row.limit)}`).join(" · ")}</div>}</div><DialogFooter>{budgetLimits.some(row => row.category === budgetCategory) && <Button variant="outline" className="mr-auto text-[#c94958]" onClick={deleteBudget}>이 분류 삭제</Button>}<Button variant="outline" onClick={() => setBudgetOpen(false)}>취소</Button><Button onClick={saveBudget}>예산 저장</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={goalOpen} onOpenChange={setGoalOpen}><DialogContent><DialogHeader><DialogTitle>월 저축 목표 수정</DialogTitle><DialogDescription>선택한 달의 수입에서 지출을 뺀 금액과 비교해 달성률을 계산합니다.</DialogDescription></DialogHeader><Label text="목표 금액"><Input inputMode="numeric" value={goalAmount} onChange={event => setGoalAmount(event.target.value)} placeholder="0"/></Label><DialogFooter>{savingsTarget > 0 && <Button variant="outline" className="mr-auto text-[#c94958]" onClick={() => { setSavingsTarget(0); setGoalOpen(false); toast.success("저축 목표를 삭제했습니다."); }}>목표 삭제</Button>}<Button variant="outline" onClick={() => setGoalOpen(false)}>취소</Button><Button onClick={saveGoal}>목표 저장</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={fixedOpen} onOpenChange={setFixedOpen}><DialogContent className="sm:max-w-xl"><DialogHeader><DialogTitle>고정비 관리</DialogTitle><DialogDescription>매달 반복되는 비용과 결제일을 등록하세요.</DialogDescription></DialogHeader><div className="space-y-4">{fixedCosts.length ? <div className="max-h-48 space-y-2 overflow-y-auto">{[...fixedCosts].sort((a, b) => a.day - b.day).map(item => <div key={item.id} className="flex items-center gap-3 rounded-xl bg-[#f5f8fa] p-3"><span className="text-sm font-bold text-[#168469]">매월 {item.day}일</span><b className="flex-1 text-sm">{item.name}</b><span className="text-sm font-semibold">{money(item.amount)}</span><Button variant="ghost" size="icon-sm" aria-label={`${item.name} 삭제`} onClick={() => setFixedCosts(fixedCosts.filter(row => row.id !== item.id))}><Trash2 className="text-[#c94958]"/></Button></div>)}</div> : <p className="rounded-xl bg-[#f5f8fa] p-4 text-center text-sm text-[#74838d]">등록된 고정비가 없어요.</p>}<div className="grid gap-3 sm:grid-cols-[1fr_150px_110px]"><Label text="고정비 이름"><Input value={fixedName} onChange={event => setFixedName(event.target.value)} placeholder="예: 통신비"/></Label><Label text="월 금액"><Input inputMode="numeric" value={fixedAmount} onChange={event => setFixedAmount(event.target.value)} placeholder="0"/></Label><Label text="결제일"><Input inputMode="numeric" value={fixedDay} onChange={event => setFixedDay(event.target.value)} placeholder="1~31"/></Label></div><Button className="w-full" variant="outline" onClick={addFixedCost}><Plus />고정비 추가</Button></div><DialogFooter><Button onClick={() => setFixedOpen(false)}>완료</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
type GeneralAssetCategory = "cashDeposits" | "pensions" | "realEstate" | "otherAssets";
type SavingAsset = {
    name: string;
    institution: string;
    value: number;
    rate: number;
    currency: string;
    owner: string;
    category?: GeneralAssetCategory;
};
type InvestmentAsset = {
    name: string;
    market: string;
    ticker?: string;
    value: number;
    purchase: number;
    currency: string;
    quantity: number;
    averagePrice: number;
    owner: string;
};
type MarketQuote = {
    ticker: string;
    name: string;
    market: string;
    price: number;
    date: string;
};
type MarketDataResponse = {
    quotes?: MarketQuote[];
    missing?: string[];
    message?: string;
};
type LoanAsset = {
    name: string;
    institution: string;
    value: number;
    rate: string;
    owner: string;
};
type AssetMonthlySnapshot = {
    id: string;
    year: number;
    month: number;
    snapshotDate: string;
    cashDeposits: number;
    stocks: number;
    fundsEtfs: number;
    pensions: number;
    realEstate: number;
    otherAssets: number;
    totalAssets: number;
    totalLiabilities: number;
    netWorth: number;
    createdAt: string;
    updatedAt: string;
};
type AssetSnapshot = {
    savings: SavingAsset[];
    holdings: InvestmentAsset[];
    loans: LoanAsset[];
};
type AssetHistory = Record<string, AssetSnapshot>;
type AssetEdit = {
    kind: "saving" | "investment" | "loan";
    index: number;
};
type AssetEditForm = {
    owner: string;
    name: string;
    institution: string;
    market: string;
    ticker: string;
    value: string;
    rate: string;
    currency: string;
    quantity: string;
    averagePrice: string;
    purchase: string;
    assetCategory: GeneralAssetCategory;
};
const emptyAssetEdit: AssetEditForm = { owner: "", name: "", institution: "", market: "", ticker: "", value: "", rate: "", currency: "KRW", quantity: "", averagePrice: "", purchase: "", assetCategory: "cashDeposits" };
const assetMoney = (value: number, currency = "KRW") => currency === "USD" ? `$${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : `${value.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}원`;
const generalAssetCategoryLabel: Record<GeneralAssetCategory, string> = { cashDeposits: "현금·예금", pensions: "연금", realEstate: "부동산", otherAssets: "기타 자산" };
const loanRateValue = (rate: string) => Number(rate.replace(/[^0-9.-]/g, "")) || 0;
const investmentTicker = (row: InvestmentAsset) => { const direct = row.ticker?.toUpperCase().replace(/[^0-9A-Z]/g, ""); if (direct && /^[0-9A-Z]{6}$/.test(direct))
    return direct; const code = /[^0-9A-Z]([0-9A-Z]{6})(?![0-9A-Z])/; return ` ${row.market}`.toUpperCase().match(code)?.[1] || ` ${row.name}`.toUpperCase().match(code)?.[1] || ""; };
const emptyAssetSnapshot = (): AssetSnapshot => ({ savings: [], holdings: [], loans: [] });
const normalizeAssetHistory = (history: unknown): AssetHistory => {
    if (!history || typeof history !== "object") return {};
    return Object.fromEntries(Object.entries(history as Record<string, unknown>).flatMap(([month, source]) => {
        if (!/^\d{4}-\d{2}$/.test(month) || !source || typeof source !== "object") return [];
        const snapshot = source as Partial<AssetSnapshot>;
        return [[month, {
            savings: Array.isArray(snapshot.savings) ? snapshot.savings : [],
            holdings: Array.isArray(snapshot.holdings) ? snapshot.holdings : [],
            loans: Array.isArray(snapshot.loans) ? snapshot.loans : [],
        }]];
    })) as AssetHistory;
};
const cloneAssetSnapshot = (snapshot: AssetSnapshot): AssetSnapshot => ({ savings: snapshot.savings.map(row => ({ ...row })), holdings: snapshot.holdings.map(row => ({ ...row })), loans: snapshot.loans.map(row => ({ ...row })) });
const previousAssetMonth = (history: AssetHistory, key: string) => Object.keys(history).filter(month => month < key).sort((a, b) => b.localeCompare(a))[0];
const resolveAssetSnapshot = (history: AssetHistory, key: string) => history[key] ? cloneAssetSnapshot(history[key]) : previousAssetMonth(history, key) ? cloneAssetSnapshot(history[previousAssetMonth(history, key)]) : emptyAssetSnapshot();
const assetSnapshotFields = [
    { key: "cashDeposits", label: "현금/예금", color: "#168469" },
    { key: "stocks", label: "주식", color: "#4776e6" },
    { key: "fundsEtfs", label: "펀드/ETF", color: "#826da8" },
    { key: "pensions", label: "연금", color: "#c27624" },
    { key: "realEstate", label: "부동산", color: "#2a6990" },
    { key: "otherAssets", label: "기타 자산", color: "#74838d" },
] as const;
type AssetSnapshotField = typeof assetSnapshotFields[number]["key"];
const isFundEtf = (asset: InvestmentAsset) => /ETF|ETN|펀드|TIGER|KODEX|ACE|RISE|SOL|PLUS|HANARO|KOSEF|TIMEFOLIO|ARIRANG/i.test(`${asset.name} ${asset.market}`);
const assetSnapshotSourceValues = (snapshot: AssetSnapshot) => {
    const generalAssets = snapshot.savings.filter(asset => asset.currency === "KRW");
    const byCategory = (category: GeneralAssetCategory) => generalAssets.filter(asset => (asset.category || "cashDeposits") === category).reduce((sum, asset) => sum + asset.value, 0);
    const cashDeposits = byCategory("cashDeposits");
    const pensions = byCategory("pensions");
    const realEstate = byCategory("realEstate");
    const otherAssets = byCategory("otherAssets");
    const fundsEtfs = snapshot.holdings.filter(asset => asset.currency === "KRW" && isFundEtf(asset)).reduce((sum, asset) => sum + asset.value, 0);
    const stocks = snapshot.holdings.filter(asset => asset.currency === "KRW" && !isFundEtf(asset)).reduce((sum, asset) => sum + asset.value, 0);
    const totalLiabilities = snapshot.loans.reduce((sum, asset) => sum + asset.value, 0);
    return { cashDeposits, stocks, fundsEtfs, pensions, realEstate, otherAssets, totalLiabilities };
};
const assetMonthlyRecord = (key: string, snapshot: AssetSnapshot): AssetMonthlySnapshot => {
    const [year, month] = key.split("-").map(Number);
    const values = assetSnapshotSourceValues(snapshot);
    const totalAssets = values.cashDeposits + values.stocks + values.fundsEtfs + values.pensions + values.realEstate + values.otherAssets;
    return { id: `asset-${key}`, year, month, snapshotDate: `${key}-01`, ...values, totalAssets, netWorth: totalAssets - values.totalLiabilities, createdAt: `${key}-01T00:00:00.000Z`, updatedAt: `${key}-01T00:00:00.000Z` };
};
function Assets({ refreshing, updated, refresh, nicknames, activeMonth, assetHistory, setAssetHistory }: {
    refreshing: boolean;
    updated: string;
    refresh: (month: string) => Promise<void>;
    nicknames: {
        me: string;
        partner: string;
    };
    activeMonth: string;
    assetHistory: AssetHistory;
    setAssetHistory: (history: AssetHistory | ((history: AssetHistory) => AssetHistory)) => void;
}) {
    const [open, setOpen] = useState(false);
    const [kind, setKind] = useState("saving");
    const [assetCategory, setAssetCategory] = useState<GeneralAssetCategory>("cashDeposits");
    const [name, setName] = useState("");
    const [institution, setInstitution] = useState("");
    const [ticker, setTicker] = useState("");
    const [value, setValue] = useState("");
    const [detail, setDetail] = useState("");
    const [importedFile, setImportedFile] = useState("");
    const assetFileRef = useRef<HTMLInputElement>(null);
    const [editing, setEditing] = useState<AssetEdit | null>(null);
    const [editForm, setEditForm] = useState<AssetEditForm>(emptyAssetEdit);
    const [assetMonth, setAssetMonth] = useState(activeMonth);
    useEffect(() => setAssetMonth(activeMonth), [activeMonth]);
    const inheritedFrom = assetHistory[assetMonth] ? undefined : previousAssetMonth(assetHistory, assetMonth);
    const snapshot = resolveAssetSnapshot(assetHistory, assetMonth);
    const { holdings, savings, loans } = snapshot;
    const setSavings = (update: SavingAsset[] | ((rows: SavingAsset[]) => SavingAsset[])) => setAssetHistory(history => { const base = resolveAssetSnapshot(history, assetMonth); return { ...history, [assetMonth]: { ...base, savings: typeof update === "function" ? update(base.savings) : update } }; });
    const setHoldings = (update: InvestmentAsset[] | ((rows: InvestmentAsset[]) => InvestmentAsset[])) => setAssetHistory(history => { const base = resolveAssetSnapshot(history, assetMonth); return { ...history, [assetMonth]: { ...base, holdings: typeof update === "function" ? update(base.holdings) : update } }; });
    const setLoans = (update: LoanAsset[] | ((rows: LoanAsset[]) => LoanAsset[])) => setAssetHistory(history => { const base = resolveAssetSnapshot(history, assetMonth); return { ...history, [assetMonth]: { ...base, loans: typeof update === "function" ? update(base.loans) : update } }; });
    const totals = useMemo(() => { const generalKRW = savings.filter(x => x.currency === "KRW").reduce((sum, x) => sum + x.value, 0); const cashDepositsKRW = savings.filter(x => x.currency === "KRW" && (x.category || "cashDeposits") === "cashDeposits").reduce((sum, x) => sum + x.value, 0); const monthlyInterestKRW = savings.filter(x => x.currency === "KRW" && (x.category || "cashDeposits") === "cashDeposits").reduce((sum, x) => sum + x.value * x.rate / 100 / 12, 0); const krwHoldings = holdings.filter(x => x.currency === "KRW"); const holdingsKRW = krwHoldings.reduce((sum, x) => sum + x.value, 0); const purchasesKRW = krwHoldings.reduce((sum, x) => sum + x.purchase, 0); const investmentGainKRW = holdingsKRW - purchasesKRW; const investmentRateKRW = purchasesKRW ? investmentGainKRW / purchasesKRW * 100 : 0; const debt = loans.reduce((sum, x) => sum + x.value, 0); const monthlyLoanInterest = loans.reduce((sum, x) => sum + x.value * loanRateValue(x.rate) / 100 / 12, 0); return { generalKRW, cashDepositsKRW, monthlyInterestKRW, holdingsKRW, purchasesKRW, investmentGainKRW, investmentRateKRW, debt, monthlyLoanInterest, net: generalKRW + holdingsKRW - debt, foreign: savings.filter(x => x.currency !== "KRW").length + holdings.filter(x => x.currency !== "KRW").length }; }, [savings, holdings, loans]);
    const monthlySnapshots = useMemo(() => {
        const records = Object.entries(assetHistory).filter(([month]) => /^\d{4}-\d{2}$/.test(month)).map(([month, assetSnapshot]) => ({ month, snapshot: assetMonthlyRecord(month, assetSnapshot) }));
        if (!records.some(record => record.month === assetMonth))
            records.push({ month: assetMonth, snapshot: assetMonthlyRecord(assetMonth, snapshot) });
        return records.sort((a, b) => b.month.localeCompare(a.month));
    }, [assetHistory, assetMonth, snapshot]);
    const currentMonthlySnapshot = monthlySnapshots.find(record => record.month === assetMonth)?.snapshot;
    const previousMonthlySnapshot = useMemo(() => monthlySnapshots.filter(row => row.month < assetMonth).sort((a, b) => b.month.localeCompare(a.month))[0]?.snapshot, [monthlySnapshots, assetMonth]);
    const removeAsset = (label: string, action: () => void) => { action(); toast.success(`${label} 항목을 삭제했습니다.`); };
    const editNumber = (text: string) => Number(text.replace(/,/g, "").replace(/[^0-9.-]/g, "")) || 0;
    const startEdit = (kind: AssetEdit["kind"], index: number) => { setEditing({ kind, index }); if (kind === "saving") {
        const row = savings[index];
        setEditForm({ ...emptyAssetEdit, owner: row.owner, name: row.name, institution: row.institution, value: String(row.value), rate: String(row.rate), currency: row.currency, assetCategory: row.category || "cashDeposits" });
    }
    else if (kind === "investment") {
        const row = holdings[index];
        setEditForm({ ...emptyAssetEdit, owner: row.owner, name: row.name, market: row.market, ticker: investmentTicker(row), value: String(row.value), currency: row.currency, quantity: String(row.quantity), averagePrice: String(row.averagePrice), purchase: String(row.purchase) });
    }
    else {
        const row = loans[index];
        setEditForm({ ...emptyAssetEdit, owner: row.owner, name: row.name, institution: row.institution, value: String(row.value), rate: row.rate.replace("%", "") });
    } };
    const saveEdit = () => { if (!editing || !editForm.name.trim() || !editNumber(editForm.value)) {
        toast.error("이름과 금액을 입력해주세요.");
        return;
    } if (editing.kind === "investment" && editForm.currency === "KRW" && !/^[0-9A-Z]{6}$/.test(editForm.ticker.trim().toUpperCase())) {
        toast.error("국내 종목코드 6자리(영문·숫자)를 입력해주세요.");
        return;
    } if (editing.kind === "saving")
        setSavings(old => old.map((row, index) => index === editing.index ? { ...row, owner: editForm.owner || nicknames.me, name: editForm.name.trim(), institution: editForm.institution.trim() || "직접 입력", value: editNumber(editForm.value), rate: editNumber(editForm.rate), currency: editForm.currency, category: editForm.assetCategory } : row)); if (editing.kind === "investment")
        setHoldings(old => old.map((row, index) => index === editing.index ? { ...row, owner: editForm.owner || nicknames.me, name: editForm.name.trim(), market: editForm.market.trim() || "기타", ticker: editForm.ticker.trim().toUpperCase(), value: editNumber(editForm.value), purchase: editNumber(editForm.purchase), currency: editForm.currency, quantity: editNumber(editForm.quantity), averagePrice: editNumber(editForm.averagePrice) } : row)); if (editing.kind === "loan")
        setLoans(old => old.map((row, index) => index === editing.index ? { ...row, owner: editForm.owner || nicknames.me, name: editForm.name.trim(), institution: editForm.institution.trim() || "직접 입력", value: editNumber(editForm.value), rate: `${editNumber(editForm.rate)}%` } : row)); setEditing(null); toast.success("자산 정보를 수정했습니다."); };
    const saveAsset = () => { const n = Number(value.replaceAll(",", "") || 0); if (!name.trim() || !n) {
        toast.error("이름과 금액을 입력해주세요.");
        return;
    } if (kind === "investment" && !/^[0-9A-Z]{6}$/.test(ticker.trim().toUpperCase())) {
        toast.error("국내 종목코드 6자리(영문·숫자)를 입력해주세요.");
        return;
    } const d = Number(detail.replace(/[^0-9.-]/g, "")) || 0; if (kind === "saving")
        setSavings(x => [{ name, institution: institution || "직접 입력", value: n, rate: d, currency: "KRW", owner: nicknames.me, category: assetCategory }, ...x]); if (kind === "investment")
        setHoldings(x => [{ name, market: institution || "KRX", ticker: ticker.trim().toUpperCase(), value: n, purchase: n, currency: "KRW", quantity: d ? n / d : 0, averagePrice: d, owner: nicknames.me }, ...x]); if (kind === "loan")
        setLoans(x => [{ name, institution: institution || "직접 입력", value: n, rate: d ? `${d}%` : "금리 미입력", owner: nicknames.me }, ...x]); setOpen(false); setName(""); setInstitution(""); setTicker(""); setValue(""); setDetail(""); toast.success("자산 정보를 저장했습니다."); };
    const importAssets = async (file?: File) => { if (!file)
        return; const notice = toast.loading(`${file.name} 자산 정리 중`); try {
        const result = await parseAssetFile(file);
        if (result.savings.length)
            setSavings(result.savings.map(x => ({ name: x.name, institution: x.institution, value: x.balance, rate: x.rate, currency: x.currency, owner: x.owner || nicknames.me, category: "cashDeposits" })));
        if (result.investments.length)
            setHoldings(result.investments.map(x => { const purchase = x.invested || x.averagePrice * x.quantity; const evaluated = x.currentPrice ? x.currentPrice * x.quantity : purchase; return { name: x.name, market: x.market, ticker: x.ticker, value: evaluated, purchase, currency: x.currency, quantity: x.quantity, averagePrice: x.averagePrice, owner: x.owner || nicknames.me }; }));
        if (result.loans.length)
            setLoans(result.loans.map(x => ({ name: x.name, institution: x.institution, value: x.principal, rate: `${x.rate.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}%`, owner: x.owner || nicknames.me })));
        setImportedFile(file.name);
        toast.success("자산 엑셀을 반영했습니다.", { id: notice, description: `저축 ${result.savings.length}건 · 투자 ${result.investments.length}건 · 대출 ${result.loans.length}건` });
    }
    catch (error) {
        toast.error("자산 파일을 가져오지 못했습니다.", { id: notice, description: error instanceof Error ? error.message : "양식과 입력값을 확인해주세요." });
    }
    finally {
        if (assetFileRef.current)
            assetFileRef.current.value = "";
    } };
    return <div className="space-y-5"><div className="flex flex-col justify-between gap-3 xl:flex-row xl:items-end"><div><h2 className="text-2xl font-black">자산과 투자</h2><p className="text-sm text-[#6d7d8b]">이전 달 기록을 자동으로 이어받고, 수정한 달은 별도 기록으로 보관합니다.</p><p className="mt-1 text-xs text-[#8a979f]">최근 시세 갱신 {updated}{importedFile && ` · 최근 가져온 파일 ${importedFile}`}</p><p className="mt-1 text-xs leading-5 text-[#74838d]">출처: <a className="font-semibold underline underline-offset-2" href="https://apiportal.koreainvestment.com/" target="_blank" rel="noreferrer">한국투자증권 Open API</a> · 장중에는 현재가, 장 마감 뒤에는 최종 시세가 표시될 수 있음</p></div><div className="flex flex-wrap gap-2"><Select value={assetMonth.slice(0, 4)} onValueChange={year => setAssetMonth(`${year}-${assetMonth.slice(5, 7)}`)}><SelectTrigger className="w-28" aria-label="자산 연도"><SelectValue /></SelectTrigger><SelectContent>{Array.from(new Set([activeMonth.slice(0, 4), ...Object.keys(assetHistory).map(month => month.slice(0, 4))])).sort((a, b) => b.localeCompare(a)).map(year => <SelectItem key={year} value={year}>{year}년</SelectItem>)}</SelectContent></Select><Select value={String(Number(assetMonth.slice(5, 7)))} onValueChange={month => setAssetMonth(`${assetMonth.slice(0, 4)}-${String(month).padStart(2, "0")}`)}><SelectTrigger className="w-24" aria-label="자산 월"><SelectValue /></SelectTrigger><SelectContent>{Array.from({ length: 12 }, (_, index) => index + 1).map(month => <SelectItem key={month} value={String(month)}>{month}월</SelectItem>)}</SelectContent></Select><Button variant="outline" asChild><a href="/templates/우리장부_자산투자_입력양식.xlsx" download><Download />양식 다운로드</a></Button><Button variant="outline" onClick={() => assetFileRef.current?.click()}><Upload />자산 엑셀 가져오기</Button><input ref={assetFileRef} className="hidden" type="file" accept=".xlsx" onChange={e => importAssets(e.target.files?.[0])}/><Button variant="outline" onClick={() => setOpen(true)}><Plus />한 건 추가</Button><Button onClick={() => void refresh(assetMonth)} disabled={refreshing} className="bg-[#173f69]"><RefreshCw className={refreshing ? "animate-spin" : ""}/>{refreshing ? "시세 확인 중" : "최근 시세로 갱신"}</Button></div></div><div className="rounded-2xl border border-[#bee3d8] bg-[#eaf8f4] p-4 text-sm text-[#35675a]">{inheritedFrom ? <><b>{monthLabel(assetMonth)}은 {monthLabel(inheritedFrom)} 기록을 이어받았습니다.</b> 수정하거나 파일을 가져오면 이 달의 기록으로 따로 저장됩니다.</> : assetHistory[assetMonth] ? <><b>{monthLabel(assetMonth)} 기록입니다.</b> 변경사항은 다른 달의 기록에 영향을 주지 않습니다.</> : <><b>첫 자산 기록을 추가해주세요.</b> 다음 달부터 가장 가까운 이전 달 기록을 자동으로 이어받습니다.</>}</div><section className="grid gap-4 sm:grid-cols-3"><Metric icon={Landmark} label="현금·예금·기타 자산" value={assetMoney(totals.generalKRW)} note={`현금·예금 월 예상이자 ${assetMoney(totals.monthlyInterestKRW)} · 세전`} tone="mint"/><Metric icon={TrendingUp} label="투자 평가액(원화)" value={assetMoney(totals.holdingsKRW)} note={`${totals.investmentGainKRW >= 0 ? "+" : ""}${assetMoney(totals.investmentGainKRW)} · ${totals.investmentRateKRW >= 0 ? "+" : ""}${totals.investmentRateKRW.toFixed(1)}%`} tone="blue"/><Metric icon={CircleDollarSign} label="순자산(원화)" value={assetMoney(totals.net)} note={totals.foreign ? `외화 자산 ${totals.foreign}건 별도 표시` : "대출 원금 반영"} tone="amber"/></section>
    <AssetTrendOverview records={monthlySnapshots} currentSnapshot={currentMonthlySnapshot} previousSnapshot={previousMonthlySnapshot}/>
    <Panel title="현금·예금·기타 자산" action="자산 추가" onAction={() => { setKind("saving"); setOpen(true); }}><p className="mb-3 text-xs text-[#74838d]">현금·예금의 월 예상이자만 현재 잔액 × 연이율 ÷ 12로 계산한 세전 금액입니다. 표는 좌우로 밀어 전체 항목을 볼 수 있어요.</p><div className="overflow-x-auto"><Table className="min-w-[820px]"><TableHeader><TableRow><TableHead>자산명</TableHead><TableHead>분류</TableHead><TableHead>작성자</TableHead><TableHead>금융기관</TableHead><TableHead className="text-right">현재 잔액</TableHead><TableHead className="text-right">연이율/참고</TableHead><TableHead className="text-right">월 예상이자</TableHead></TableRow></TableHeader><TableBody>{!savings.length && <EmptyTableRow columns={7} label="등록된 자산이 없어요"/>}{savings.map((r, i) => <TableRow key={`${r.name}-${i}`}><TableCell><div className="flex items-center gap-1"><b>{r.name}</b><Button variant="ghost" size="icon-sm" aria-label={`${r.name} 수정`} onClick={() => startEdit("saving", i)}><Pencil className="text-[#287b67]"/></Button><Button variant="ghost" size="icon-sm" aria-label={`${r.name} 삭제`} onClick={() => removeAsset(r.name, () => setSavings(old => old.filter((_, index) => index !== i)))}><Trash2 className="text-[#c94958]"/></Button></div></TableCell><TableCell><span className="rounded-full bg-[#f0f5f6] px-2.5 py-1 text-xs font-semibold">{generalAssetCategoryLabel[r.category || "cashDeposits"]}</span></TableCell><TableCell><span className="rounded-full bg-[#e8f8f3] px-2.5 py-1 text-xs font-bold text-[#16745e]">{r.owner}</span></TableCell><TableCell className="text-[#6d7d8b]">{r.institution}</TableCell><TableCell className="text-right font-semibold">{assetMoney(r.value, r.currency)}</TableCell><TableCell className="text-right">{r.rate.toFixed(2)}%</TableCell><TableCell className="text-right font-bold text-[#168469]">{(r.category || "cashDeposits") === "cashDeposits" ? assetMoney(r.value * r.rate / 100 / 12, r.currency) : "-"}</TableCell></TableRow>)}</TableBody></Table></div></Panel>
    <Panel title="투자 포트폴리오" action="종목 추가" onAction={() => { setKind("investment"); setOpen(true); }}><div className="mb-4 grid gap-2 sm:grid-cols-4"><Info label="총매입금(원화)" value={assetMoney(totals.purchasesKRW)}/><Info label="평가금(원화)" value={assetMoney(totals.holdingsKRW)}/><Info label="평가손익(원화)" value={`${totals.investmentGainKRW > 0 ? "+" : ""}${assetMoney(totals.investmentGainKRW)}`}/><Info label="수익률(원화)" value={`${totals.investmentRateKRW > 0 ? "+" : ""}${totals.investmentRateKRW.toFixed(2)}%`}/></div><p className="mb-3 text-xs text-[#74838d]">국내 종목은 6자리 종목코드로 최근 종가를 갱신합니다. 외화 종목은 환산하지 않고 각 통화 기준 성과를 표시합니다.</p><div className="overflow-x-auto"><Table className="min-w-[860px]"><TableHeader><TableRow><TableHead>종목·작성자</TableHead><TableHead className="text-right">보유수량·평균가</TableHead><TableHead className="text-right">총매입금</TableHead><TableHead className="text-right">평가금</TableHead><TableHead className="text-right">손익금</TableHead><TableHead className="text-right">수익률</TableHead></TableRow></TableHeader><TableBody>{!holdings.length && <EmptyTableRow columns={6} label="등록된 투자 종목이 없어요"/>}{holdings.map((r, i) => { const gain = r.value - r.purchase; const rate = r.purchase ? gain / r.purchase * 100 : 0; const tone = gain >= 0 ? "text-[#168469]" : "text-[#365fc8]"; const code = investmentTicker(r); const marketLabel = code && !r.market.includes(code) ? `${r.market} · ${code}` : r.market; return <TableRow key={`${r.name}-${i}`}><TableCell className="min-w-52"><div className="flex items-center gap-1"><b>{r.name}</b><Button variant="ghost" size="icon-sm" aria-label={`${r.name} 수정`} onClick={() => startEdit("investment", i)}><Pencil className="text-[#287b67]"/></Button><Button variant="ghost" size="icon-sm" aria-label={`${r.name} 삭제`} onClick={() => removeAsset(r.name, () => setHoldings(old => old.filter((_, index) => index !== i)))}><Trash2 className="text-[#c94958]"/></Button></div><div className="mt-1 flex items-center gap-2 text-xs text-[#6d7d8b]"><span className="rounded-full bg-[#e8f8f3] px-2 py-0.5 font-bold text-[#16745e]">{r.owner}</span><span>{marketLabel}</span></div></TableCell><TableCell className="text-right"><b>{r.quantity ? r.quantity.toLocaleString("ko-KR") : "-"}</b><small className="mt-1 block text-[#74838d]">평균 {r.averagePrice ? assetMoney(r.averagePrice, r.currency) : "-"}</small></TableCell><TableCell className="text-right">{assetMoney(r.purchase, r.currency)}</TableCell><TableCell className="text-right font-semibold">{assetMoney(r.value, r.currency)}</TableCell><TableCell className={`text-right font-bold ${tone}`}>{gain >= 0 ? "+" : ""}{assetMoney(gain, r.currency)}</TableCell><TableCell className={`text-right font-black ${tone}`}>{rate >= 0 ? "+" : ""}{rate.toFixed(2)}%</TableCell></TableRow>; })}</TableBody></Table></div></Panel>
    <Panel title="대출·부채" action="대출 추가" onAction={() => { setKind("loan"); setOpen(true); }}><div className="mb-4 grid gap-2 sm:grid-cols-2"><Info label="남은 원금 합계" value={assetMoney(totals.debt)}/><Info label="월 예상이자 합계" value={assetMoney(totals.monthlyLoanInterest)}/></div><p className="mb-3 text-xs text-[#74838d]">월 예상이자는 남은 원금 × 연 금리 ÷ 12로 단순 계산합니다. 실제 이자는 상환 방식과 일수 계산에 따라 달라질 수 있어요.</p><div className="overflow-x-auto"><Table className="min-w-[820px]"><TableHeader><TableRow><TableHead>대출명</TableHead><TableHead>작성자</TableHead><TableHead>금융기관</TableHead><TableHead className="text-right">남은 원금</TableHead><TableHead className="text-right">금리</TableHead><TableHead className="text-right">월 예상이자</TableHead></TableRow></TableHeader><TableBody>{!loans.length && <EmptyTableRow columns={6} label="등록된 대출·부채가 없어요"/>}{loans.map((r, i) => { const rate = loanRateValue(r.rate); return <TableRow key={`${r.name}-${i}`}><TableCell><div className="flex items-center gap-1"><b>{r.name}</b><Button variant="ghost" size="icon-sm" aria-label={`${r.name} 수정`} onClick={() => startEdit("loan", i)}><Pencil className="text-[#287b67]"/></Button><Button variant="ghost" size="icon-sm" aria-label={`${r.name} 삭제`} onClick={() => removeAsset(r.name, () => setLoans(old => old.filter((_, index) => index !== i)))}><Trash2 className="text-[#c94958]"/></Button></div></TableCell><TableCell><span className="rounded-full bg-[#e8f8f3] px-2.5 py-1 text-xs font-bold text-[#16745e]">{r.owner}</span></TableCell><TableCell className="text-[#6d7d8b]">{r.institution}</TableCell><TableCell className="text-right font-semibold">{assetMoney(r.value)}</TableCell><TableCell className="text-right">{r.rate}</TableCell><TableCell className="text-right font-bold text-[#c27624]">{rate ? assetMoney(r.value * rate / 100 / 12) : "금리 입력 필요"}</TableCell></TableRow>; })}</TableBody></Table></div></Panel>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogHeader><DialogTitle>자산 정보 추가</DialogTitle><DialogDescription>파일에 넣기 전 급한 항목만 한 건씩 등록할 수 있습니다.</DialogDescription></DialogHeader><div className="grid gap-4"><Label text="종류"><Select value={kind} onValueChange={setKind}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="saving">저축·예금</SelectItem><SelectItem value="investment">주식·ETF</SelectItem><SelectItem value="loan">대출</SelectItem></SelectContent></Select></Label>{kind === "saving" && <Label text="자산 분류"><Select value={assetCategory} onValueChange={(category: GeneralAssetCategory) => setAssetCategory(category)}><SelectTrigger className="w-full"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="cashDeposits">현금·예금</SelectItem><SelectItem value="pensions">연금</SelectItem><SelectItem value="realEstate">부동산</SelectItem><SelectItem value="otherAssets">기타 자산</SelectItem></SelectContent></Select></Label>}<Label text={kind === "investment" ? "종목명" : kind === "loan" ? "대출명" : "자산명"}><Input value={name} onChange={e => setName(e.target.value)} placeholder={kind === "investment" ? "예: TIGER 미국S&P500" : "이름을 입력하세요"}/></Label>{kind === "investment" && <Label text="국내 종목코드 (6자리 영문·숫자)"><Input inputMode="text" autoCapitalize="characters" maxLength={6} value={ticker} onChange={e => setTicker(e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, "").slice(0, 6))} placeholder="예: 360750, 0183J0"/></Label>}<Label text={kind === "investment" ? "시장" : "금융기관"}><Input value={institution} onChange={e => setInstitution(e.target.value)} placeholder={kind === "investment" ? "예: KOSPI, KOSDAQ" : "예: 기업은행"}/></Label><Label text={kind === "loan" ? "남은 원금" : kind === "investment" ? "총매입금" : "현재 잔액"}><Input inputMode="numeric" value={value} onChange={e => setValue(e.target.value)} placeholder="0"/></Label><Label text={kind === "saving" ? assetCategory === "cashDeposits" ? "연이율 (%)" : "참고 수익률 (%)" : kind === "loan" ? "금리 (%)" : "평균 매입가"}><Input value={detail} onChange={e => setDetail(e.target.value)} placeholder={kind === "saving" ? "예: 3.50" : kind === "loan" ? "예: 3.82" : "예: 17500"}/></Label></div><DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>취소</Button><Button onClick={saveAsset}>저장</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={!!editing} onOpenChange={next => { if (!next)
        setEditing(null); }}><DialogContent className="max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>{editing?.kind === "saving" ? "저축·예금" : editing?.kind === "investment" ? "투자 종목" : "대출"} 정보 수정</DialogTitle><DialogDescription>저장하면 합계와 이자·투자성과가 바로 다시 계산됩니다.</DialogDescription></DialogHeader><div className="grid gap-4 sm:grid-cols-2"><Label text="작성자"><Select value={editForm.owner} onValueChange={owner => setEditForm(old => ({ ...old, owner }))}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{![nicknames.me, nicknames.partner].includes(editForm.owner) && editForm.owner && <SelectItem value={editForm.owner}>{editForm.owner}</SelectItem>}<SelectItem value={nicknames.me}>{nicknames.me}</SelectItem><SelectItem value={nicknames.partner}>{nicknames.partner}</SelectItem></SelectContent></Select></Label><Label text={editing?.kind === "investment" ? "종목명" : editing?.kind === "loan" ? "대출명" : "자산명"}><Input value={editForm.name} onChange={e => setEditForm(old => ({ ...old, name: e.target.value }))}/></Label>{editing?.kind === "investment" ? <><Label text="시장"><Input value={editForm.market} onChange={e => setEditForm(old => ({ ...old, market: e.target.value }))} placeholder="예: KOSPI"/></Label><Label text="국내 종목코드 (6자리 영문·숫자)"><Input inputMode="text" autoCapitalize="characters" maxLength={6} value={editForm.ticker} onChange={e => setEditForm(old => ({ ...old, ticker: e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, "").slice(0, 6) }))} placeholder="예: 360750, 0183J0"/></Label><Label text="통화"><Select value={editForm.currency} onValueChange={currency => setEditForm(old => ({ ...old, currency }))}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="KRW">KRW</SelectItem><SelectItem value="USD">USD</SelectItem></SelectContent></Select></Label><Label text="보유수량"><Input inputMode="decimal" value={editForm.quantity} onChange={e => setEditForm(old => ({ ...old, quantity: e.target.value }))}/></Label><Label text="평균매입가"><Input inputMode="decimal" value={editForm.averagePrice} onChange={e => setEditForm(old => ({ ...old, averagePrice: e.target.value }))}/></Label><Label text="총매입금"><Input inputMode="decimal" value={editForm.purchase} onChange={e => setEditForm(old => ({ ...old, purchase: e.target.value }))}/></Label><Label text="현재 평가금"><Input inputMode="decimal" value={editForm.value} onChange={e => setEditForm(old => ({ ...old, value: e.target.value }))}/></Label></> : <>{editing?.kind === "saving" && <Label text="자산 분류"><Select value={editForm.assetCategory} onValueChange={(assetCategory: GeneralAssetCategory) => setEditForm(old => ({ ...old, assetCategory }))}><SelectTrigger className="w-full"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="cashDeposits">현금·예금</SelectItem><SelectItem value="pensions">연금</SelectItem><SelectItem value="realEstate">부동산</SelectItem><SelectItem value="otherAssets">기타 자산</SelectItem></SelectContent></Select></Label>}<Label text="금융기관"><Input value={editForm.institution} onChange={e => setEditForm(old => ({ ...old, institution: e.target.value }))}/></Label><Label text={editing?.kind === "loan" ? "남은 원금" : "현재 잔액"}><Input inputMode="decimal" value={editForm.value} onChange={e => setEditForm(old => ({ ...old, value: e.target.value }))}/></Label><Label text={editing?.kind === "loan" ? "금리 (%)" : editForm.assetCategory === "cashDeposits" ? "연이율 (%)" : "참고 수익률 (%)"}><Input inputMode="decimal" value={editForm.rate} onChange={e => setEditForm(old => ({ ...old, rate: e.target.value }))}/></Label>{editing?.kind === "saving" && <Label text="통화"><Select value={editForm.currency} onValueChange={currency => setEditForm(old => ({ ...old, currency }))}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="KRW">KRW</SelectItem><SelectItem value="USD">USD</SelectItem></SelectContent></Select></Label>}</>}</div><DialogFooter><Button variant="outline" onClick={() => setEditing(null)}>취소</Button><Button onClick={saveEdit}>수정 내용 저장</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
function AssetTrendOverview({ records, currentSnapshot, previousSnapshot }: { records: { month: string; snapshot: AssetMonthlySnapshot }[]; currentSnapshot?: AssetMonthlySnapshot; previousSnapshot?: AssetMonthlySnapshot }) {
    const [chartMetric, setChartMetric] = useState<"overview" | AssetSnapshotField>("overview");
    const chronological = [...records].sort((a, b) => a.month.localeCompare(b.month));
    const selectedField = assetSnapshotFields.find(field => field.key === chartMetric);
    const difference = (value: number, previous?: number) => previous === undefined ? null : value - previous;
    const changeRate = (value: number, previous?: number) => previous ? (value - previous) / previous * 100 : null;
    const summaryRows = currentSnapshot ? [
        { label: "총자산", value: currentSnapshot.totalAssets, previous: previousSnapshot?.totalAssets, tone: "mint" as const },
        { label: "순자산", value: currentSnapshot.netWorth, previous: previousSnapshot?.netWorth, tone: "amber" as const },
        { label: "주식", value: currentSnapshot.stocks, previous: previousSnapshot?.stocks, tone: "blue" as const },
        { label: "현금/예금", value: currentSnapshot.cashDeposits, previous: previousSnapshot?.cashDeposits, tone: "mint" as const },
    ] : [];
    return <section className="space-y-5">
      <Panel title="전월 대비 자산 변화" action={previousSnapshot ? "직전 기록 있음" : "첫 기록"}>
        <p className="mb-4 text-sm text-[#6d7d8b]">자산을 입력하거나 수정하면 해당 월의 기록이 자동 갱신됩니다. 새 달에 변경하면 이전 달 기록은 그대로 보존됩니다.</p>
        {currentSnapshot ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{summaryRows.map(row => { const change = difference(row.value, row.previous); const rate = changeRate(row.value, row.previous); return <Metric key={row.label} icon={row.label === "순자산" ? CircleDollarSign : row.label === "주식" ? TrendingUp : Landmark} label={row.label} value={assetMoney(row.value)} note={change === null ? "직전 기록 없음" : (change >= 0 ? "+" : "") + assetMoney(change) + (rate === null ? "" : " · " + (rate >= 0 ? "+" : "") + rate.toFixed(1) + "%")} tone={row.tone}/>; })}</div> : <EmptyState title="아직 자산 기록이 없어요" description="현금·예금·연금·부동산 또는 투자 자산을 추가하면 이번 달 추이가 자동으로 시작됩니다."/>}
      </Panel>
      <Panel title="자산 변화 추이" action={chartMetric === "overview" ? "총자산·부채·순자산" : "개별 자산 항목"}>
        <div className="mb-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><p className="text-sm text-[#6d7d8b]">점 위에 마우스를 올리거나 터치하면 해당 월의 정확한 금액을 확인할 수 있어요.</p><Select value={chartMetric} onValueChange={(value: "overview" | AssetSnapshotField) => setChartMetric(value)}><SelectTrigger className="w-full sm:w-48" aria-label="자산 추이 항목"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="overview">기본 · 총자산/부채/순자산</SelectItem>{assetSnapshotFields.map(field => <SelectItem key={field.key} value={field.key}>{field.label}</SelectItem>)}</SelectContent></Select></div>
        {chronological.length ? <div className="h-[320px] w-full"><ResponsiveContainer width="100%" height="100%"><LineChart data={chronological.map(row => ({ month: row.month.replace("-", "."), ...row.snapshot }))} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}><CartesianGrid stroke="#e5ecef" vertical={false}/><XAxis dataKey="month" tickLine={false} axisLine={false}/><YAxis tickFormatter={value => Math.round(Number(value) / 10000) + "만"} tickLine={false} axisLine={false} width={48}/><Tooltip formatter={(value: number) => assetMoney(Number(value))}/><ChartLegend wrapperStyle={{ fontSize: 12 }}/>{chartMetric === "overview" ? <><Line type="monotone" dataKey="totalAssets" name="총자산" stroke="#173f69" strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 6 }}/><Line type="monotone" dataKey="totalLiabilities" name="총부채" stroke="#c94958" strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 6 }}/><Line type="monotone" dataKey="netWorth" name="순자산" stroke="#20a785" strokeWidth={2.8} dot={{ r: 3 }} activeDot={{ r: 6 }}/></> : <Line type="monotone" dataKey={chartMetric} name={selectedField?.label} stroke={selectedField?.color || "#173f69"} strokeWidth={2.8} dot={{ r: 3 }} activeDot={{ r: 6 }}/>}</LineChart></ResponsiveContainer></div> : <EmptyState title="표시할 자산 변화가 없어요" description="자산을 추가하면 이 달부터 자동으로 변화 추이를 보여드려요."/>}
      </Panel>
    </section>;
}

function SettingsView({ nicknames, onSave, onSignedIn, onClearLocalOnlyData }: {
    nicknames: {
        me: string;
        partner: string;
    };
    onSave: (v: {
        me: string;
        partner: string;
    }) => void;
    onSignedIn: (user: GoogleAccount) => void;
    onClearLocalOnlyData: () => void;
}) {
    const [open, setOpen] = useState(false);
    const [joinOpen, setJoinOpen] = useState(false);
    const [me, setMe] = useState(nicknames.me);
    const [partner, setPartner] = useState(nicknames.partner);
    const [joinCode, setJoinCode] = useState("");
    const [localDeleteOpen, setLocalDeleteOpen] = useState(false);
    const [account, setAccount] = useState<{
        configured: boolean;
        user: GoogleAccount | null;
        loading: boolean;
    }>({ configured: false, user: null, loading: true });
    const [household, setHousehold] = useState<HouseholdSummary | null>(null);
    const [working, setWorking] = useState(false);
    const loadHousehold = useCallback(async () => { const user = firebaseAuth.currentUser; if (!user)
        throw new Error("로그인이 필요합니다."); setHousehold(await firebaseHouseholdSummary(user)); }, []);
    useEffect(() => onAuthStateChanged(firebaseAuth, async (user) => { const current = user ? firebaseAccount(user) : null; setAccount({ configured: true, user: current, loading: false }); if (user)
        await loadHousehold().catch(() => undefined); }), [loadHousehold]);
    useEffect(() => { const user = firebaseAuth.currentUser; if (!user || household?.household.role !== "owner")
        return; let cancelled = false; let unsubscribe = () => undefined; void subscribeFirebasePendingRequests(user, () => { if (!cancelled)
        void loadHousehold(); }).then(listener => { if (cancelled)
        listener();
    else
        unsubscribe = listener; }).catch(() => undefined); return () => { cancelled = true; unsubscribe(); }; }, [account.user?.id, household?.household.id, household?.household.role, loadHousehold]);
    const save = () => { if (!me.trim() || !partner.trim()) {
        toast.error("두 사람의 닉네임을 입력해주세요.");
        return;
    } onSave({ me: me.trim(), partner: partner.trim() }); setOpen(false); toast.success("닉네임을 저장했습니다."); };
    const createInvite = async () => { const user = firebaseAuth.currentUser; if (!user) {
        toast.info("Google 로그인 설정 후 초대 기능을 사용할 수 있어요.");
        return;
    } setWorking(true); try {
        setHousehold(await firebaseCreateInvite(user));
        toast.success("7일 동안 사용할 수 있는 초대 코드를 만들었습니다.");
    }
    catch (error) {
        toast.error("초대 코드를 만들지 못했습니다.", { description: error instanceof Error ? error.message : "다시 시도해주세요." });
    }
    finally {
        setWorking(false);
    } };
    const copyInvite = async () => { const code = household?.household.invite_code; if (!code)
        return; await navigator.clipboard.writeText(`${location.origin}/?invite=${code}`); toast.success("초대 링크를 복사했습니다."); };
    const openJoin = () => { if (!account.user) {
        toast.info("접속 권한을 요청하려면 먼저 Google 로그인을 해주세요.");
        return;
    } setJoinOpen(true); };
    const join = async () => { const user = firebaseAuth.currentUser; if (!user)
        return; setWorking(true); try {
        const result = await firebaseRequestAccess(user, joinCode);
        setJoinOpen(false);
        setJoinCode("");
        toast.success(result.status === "already_member" ? "이미 이 장부의 구성원입니다." : "접속 권한 요청을 보냈습니다.", { description: result.status === "already_member" ? "현재 장부를 계속 사용합니다." : "소유자가 승인하면 공유 장부를 사용할 수 있어요." });
    }
    catch (error) {
        toast.error("초대 코드로 권한을 요청하지 못했습니다.", { description: error instanceof Error ? error.message : "코드를 확인해주세요." });
    }
    finally {
        setWorking(false);
    } };
    const decideRequest = async (requestId: string, decision: "approve" | "reject") => { const user = firebaseAuth.currentUser; if (!user)
        return; setWorking(true); try {
        setHousehold(await firebaseDecideAccessRequest(user, requestId, decision));
        toast.success(decision === "approve" ? "접속을 승인했습니다." : "접속 요청을 거절했습니다.");
    }
    catch (error) {
        toast.error("접속 요청을 처리하지 못했습니다.", { description: error instanceof Error ? error.message : "다시 시도해주세요." });
    }
    finally {
        setWorking(false);
    } };
    const login = async () => { setWorking(true); try {
        const provider = new GoogleAuthProvider();
        provider.setCustomParameters({ prompt: "select_account" });
        const result = await signInWithPopup(firebaseAuth, provider);
        const user = firebaseAccount(result.user);
        setAccount({ configured: true, user, loading: false });
        onSignedIn(user);
        await loadHousehold();
        toast.success("Google 로그인과 Firebase 공동 장부 연결을 완료했습니다.");
    }
    catch (error) {
        toast.error("Google 로그인에 실패했습니다.", { description: error instanceof Error ? error.message : "다시 시도해주세요." });
        await firebaseSignOut(firebaseAuth).catch(() => undefined);
    }
    finally {
        setWorking(false);
    } };
    const logout = async () => { await firebaseSignOut(firebaseAuth); location.reload(); };
    const expires = household?.household.invite_expires_at ? new Date(`${household.household.invite_expires_at.replace(" ", "T")}Z`).toLocaleDateString("ko-KR") : "";
    return <><div className="grid gap-5 xl:grid-cols-2">
    <Panel title="Google 계정" action={account.user ? "로그아웃" : "Google 로그인"} onAction={account.user ? logout : login}><div className="rounded-2xl bg-[#eef5ff] p-5">{account.loading ? <p className="text-sm text-[#5c7181]">계정을 확인하고 있어요.</p> : account.user ? <div className="flex items-center gap-3">{account.user.picture ? <img src={account.user.picture} alt="" className="size-11 rounded-full" referrerPolicy="no-referrer"/> : <span className="grid size-11 place-items-center rounded-full bg-white font-bold">{account.user.name.slice(0, 1)}</span>}<div><b>{account.user.name}</b><p className="text-sm text-[#5c7181]">{account.user.email}</p></div></div> : <div><b>개인 장부는 로그인 없이 사용할 수 있어요</b><p className="mt-1 text-sm leading-6 text-[#5c7181]">Google로 로그인하면 초대 코드로 가족과 하나의 장부를 함께 관리할 수 있습니다.</p><Button className="mt-4 bg-[#173f69]" onClick={login} disabled={working}>Google로 로그인</Button></div>}</div></Panel>
    <Panel title="가정 장부 공유" action="접속 코드 입력" onAction={openJoin}><div className="rounded-2xl bg-[#eaf8f4] p-5"><div className="flex items-center gap-3"><Users className="text-[#168469]"/><div><b>{household?.household.name || "공유 준비 중"}</b><p className="text-sm text-[#62757e]">{account.user ? `${household?.members.length || 1}명이 같은 장부를 사용 중입니다.` : "Google 로그인 후 가족을 초대하거나 접속 권한을 요청할 수 있어요."}</p></div></div>{household && <><div className="mt-4 space-y-2">{household.members.map(member => <div key={member.id} className="flex items-center justify-between rounded-xl bg-white px-3 py-2 text-sm"><span><b>{member.name}</b><small className="ml-2 text-[#74838d]">{member.email}</small></span><span className="text-xs font-bold text-[#287b67]">{member.role === "owner" ? "소유자" : "구성원"}</span></div>)}</div>{household.household.role === "owner" && <>{household.requests.length > 0 && <div className="mt-4 rounded-xl border border-[#b8deda] bg-white p-3"><b className="text-sm text-[#145b49]">접속 요청 {household.requests.length}건</b><div className="mt-2 space-y-2">{household.requests.map(request => <div key={request.id} className="flex flex-col gap-2 border-t pt-2 text-sm sm:flex-row sm:items-center sm:justify-between"><span><b>{request.name}</b><small className="ml-2 text-[#74838d]">{request.email}</small></span><span className="flex gap-2"><Button size="sm" onClick={() => decideRequest(request.id, "approve")} disabled={working}>승인</Button><Button size="sm" variant="outline" onClick={() => decideRequest(request.id, "reject")} disabled={working}>거절</Button></span></div>)}</div></div>}<div className="mt-4 rounded-xl bg-white p-3"><div className="flex items-center justify-between gap-3"><span className="text-sm">내가 만든 초대 코드</span><b className="tracking-[.14em]">{household.household.invite_code || "아직 없음"}</b></div>{household.household.invite_code && <p className="mt-1 text-right text-xs text-[#74838d]">{expires}까지 유효 · 소유자 승인 후 이용</p>}</div><div className="mt-3 grid gap-2 sm:grid-cols-3"><Button variant="outline" onClick={createInvite} disabled={working}>{household.household.invite_code ? "코드 새로 만들기" : "초대 코드 만들기"}</Button><Button variant="outline" onClick={household.household.invite_code ? copyInvite : createInvite} disabled={working}>{household.household.invite_code ? "초대 링크 복사" : "초대 만들기"}</Button><Button onClick={openJoin} disabled={working}>접속 코드 입력</Button></div></>}{household.household.role !== "owner" && <Button className="mt-4 w-full" onClick={openJoin} disabled={working}>다른 장부에 접속 요청</Button>}</>} {!household && <Button className="mt-4 w-full" onClick={openJoin}>접속 코드 입력</Button>}</div></Panel>
    <Panel title="프로필 이름" action="닉네임 수정" onAction={() => setOpen(true)}><div className="rounded-2xl bg-[#f5f8fa] p-5"><p className="text-sm text-[#5c7181]">거래 작성자와 대시보드에 표시할 이름입니다.</p><div className="mt-4 grid grid-cols-2 gap-3"><Info label="내 닉네임" value={nicknames.me}/><Info label="상대 닉네임" value={nicknames.partner}/></div></div></Panel>
    <Panel title="이 기기의 로컬 장부" action="로컬 데이터 삭제" onAction={() => setLocalDeleteOpen(true)}><div className="rounded-2xl bg-[#fff7e8] p-5"><b>현재 브라우저에만 남은 개인 장부</b><p className="mt-1 text-sm leading-6 text-[#6b5a38]">이 PC의 비로그인 장부와 가져오기 설정만 삭제합니다. Google 계정·Firebase 장부·가족 공유 데이터는 삭제되지 않습니다.</p></div></Panel>
    <Panel title="가져오기 설정" action="분류 규칙"><div className="space-y-3 text-sm"><Row label="지원 파일" value="카드·은행 엑셀/CSV"/><Row label="미지원 양식" value="열 연결 후 기억"/><Row label="원본 파일" value="분석 후 삭제" last/></div></Panel>
  </div>
  <Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogHeader><DialogTitle>닉네임 설정</DialogTitle><DialogDescription>거래 작성자와 통합 대시보드에 표시할 이름입니다.</DialogDescription></DialogHeader><div className="grid gap-4"><Label text="내 닉네임"><Input value={me} maxLength={12} onChange={e => setMe(e.target.value)} placeholder="내 이름"/></Label><Label text="상대 닉네임"><Input value={partner} maxLength={12} onChange={e => setPartner(e.target.value)} placeholder="가족 이름"/></Label></div><DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>취소</Button><Button onClick={save}>저장</Button></DialogFooter></DialogContent></Dialog>
  <Dialog open={localDeleteOpen} onOpenChange={setLocalDeleteOpen}><DialogContent><DialogHeader><DialogTitle>이 기기의 로컬 장부를 삭제할까요?</DialogTitle><DialogDescription>이 브라우저에 저장된 비로그인 장부, 자산 기록, 카드 설정, 열 연결 기억만 삭제됩니다. Google 계정과 Firebase에 저장된 장부는 삭제되지 않습니다.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setLocalDeleteOpen(false)}>취소</Button><Button variant="destructive" onClick={() => { setLocalDeleteOpen(false); onClearLocalOnlyData(); }}>이 기기 데이터 삭제</Button></DialogFooter></DialogContent></Dialog>
  <Dialog open={joinOpen} onOpenChange={setJoinOpen}><DialogContent><DialogHeader><DialogTitle>공유 장부 접속 요청</DialogTitle><DialogDescription>초대한 사람이 보낸 8자리 코드를 입력하면 장부 소유자에게 접속 권한을 요청합니다. 승인 전에는 장부 정보가 공개되지 않습니다.</DialogDescription></DialogHeader><Label text="초대 코드"><Input value={joinCode} maxLength={8} onChange={event => setJoinCode(event.target.value.toUpperCase().replace(/[^2-9A-HJ-NP-Z]/g, "").slice(0, 8))} placeholder="예: 7K9M2PQR" className="text-center text-lg font-bold tracking-[.16em]"/></Label><DialogFooter><Button variant="outline" onClick={() => setJoinOpen(false)}>취소</Button><Button onClick={join} disabled={working || joinCode.length !== 8}>접속 권한 요청</Button></DialogFooter></DialogContent></Dialog></>;
}
function Nav({ icon: I, label, active, onClick }: {
    icon: typeof Home;
    label: string;
    active: boolean;
    onClick: () => void;
}) { return <button onClick={onClick} className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold ${active ? "bg-[#2bd8ac] text-[#08231d]" : "text-white/68 hover:bg-white/8 hover:text-white"}`}><I size={18}/>{label}</button>; }
function Panel({ title, action, onAction, children }: {
    title: string;
    action: string;
    onAction?: () => void;
    children: React.ReactNode;
}) { return <section className="rounded-2xl border bg-white p-4 shadow-[0_8px_24px_rgba(20,54,88,.035)] sm:p-5"><div className="mb-5 flex justify-between"><h2 className="font-extrabold">{title}</h2><button onClick={onAction} className="text-sm font-semibold text-[#287b67]">{action}</button></div>{children}</section>; }
function Metric({ icon: I, label, value, note, tone }: {
    icon: typeof Home;
    label: string;
    value: string;
    note: string;
    tone: "mint" | "blue" | "amber" | "rose";
}) { const t = { mint: "bg-[#e3faf3] text-[#168469]", blue: "bg-[#e9f0ff] text-[#365fc8]", amber: "bg-[#fff4de] text-[#9a6a18]", rose: "bg-[#ffecef] text-[#c94958]" }; return <div className="rounded-2xl border bg-white p-4 shadow-sm"><div className={`grid size-10 place-items-center rounded-xl ${t[tone]}`}><I size={19}/></div><p className="mt-4 text-sm text-[#6d7d8b]">{label}</p><p className="mt-1 text-xl font-black">{value}</p><p className="mt-1 text-xs text-[#81909a]">{note}</p></div>; }
function TransactionTotal({ txs }: {
    txs: Tx[];
}) { const income = txs.filter(transaction => transaction.amount > 0).reduce((sum, transaction) => sum + transaction.amount, 0); const expense = Math.abs(txs.filter(transaction => transaction.amount < 0).reduce((sum, transaction) => sum + transaction.amount, 0)); const net = income - expense; return <div className="mb-4 grid gap-3 rounded-xl border border-[#bfd1d7] bg-[#edf5f6] p-3 text-sm sm:grid-cols-3 sm:items-center"><div><b className="block text-[#173f69]">필터된 거래 합계</b><span className="text-xs text-[#6d7d8b]">현재 필터 기준</span></div><span className="font-semibold text-[#168469]">수입 {money(income)}</span><span className="flex justify-between gap-3 sm:justify-end"><b>지출 {money(expense)}</b><b className={net >= 0 ? "text-[#168469]" : "text-[#c94958]"}>{signedMoney(net)}</b></span></div>; }
function TxTable({ txs, onEdit, onDelete, showTotal = false }: {
    txs: Tx[];
    onEdit?: (transaction: Tx) => void;
    onDelete?: (transaction: Tx) => void;
    showTotal?: boolean;
}) { const manageable = !!onEdit || !!onDelete; const income = txs.filter(t => t.amount > 0).reduce((sum, t) => sum + t.amount, 0); const expense = Math.abs(txs.filter(t => t.amount < 0).reduce((sum, t) => sum + t.amount, 0)); const net = income - expense; return <div className="overflow-x-auto"><Table className={manageable ? "min-w-[820px]" : ""}><TableHeader><TableRow><TableHead>날짜</TableHead><TableHead>작성자</TableHead><TableHead>거래처</TableHead><TableHead>분류</TableHead><TableHead className="hidden sm:table-cell">결제수단</TableHead><TableHead className="text-right">금액</TableHead>{manageable && <TableHead className="w-24 text-right">관리</TableHead>}</TableRow></TableHeader><TableBody>{!txs.length && <EmptyTableRow columns={manageable ? 7 : 6} label="아직 등록된 거래가 없어요"/>}{txs.map(t => <TableRow key={t.id}><TableCell className="text-[#7a8994]">{dateLabel(t.date)}</TableCell><TableCell><span className="rounded-full bg-[#e8f8f3] px-2.5 py-1 text-xs font-bold text-[#16745e]">{t.owner}</span></TableCell><TableCell><b>{t.merchant}</b></TableCell><TableCell><span className="rounded-full bg-[#f0f5f6] px-2.5 py-1 text-xs font-semibold">{t.category}</span></TableCell><TableCell className="hidden text-[#6d7d8b] sm:table-cell">{t.account}</TableCell><TableCell className={`text-right font-bold ${t.amount > 0 ? "text-[#168469]" : ""}`}>{t.amount > 0 ? "+" : "-"}{money(t.amount)}</TableCell>{manageable && <TableCell><div className="flex justify-end gap-1">{onEdit && <Button variant="ghost" size="icon-sm" aria-label={`${t.merchant} 수정`} onClick={() => onEdit(t)}><Pencil className="text-[#287b67]"/></Button>}{onDelete && <Button variant="ghost" size="icon-sm" aria-label={`${t.merchant} 삭제`} onClick={() => onDelete(t)}><Trash2 className="text-[#c94958]"/></Button>}</div></TableCell>}</TableRow>)}</TableBody>{showTotal && txs.length > 0 && <TableFooter className="border-t-2 border-[#bfd1d7] bg-[#edf5f6]"><TableRow className="hover:bg-[#edf5f6]"><TableCell colSpan={5}><b className="block text-[#173f69]">필터된 거래 총액</b><span className="text-xs font-normal text-[#6d7d8b]">수입 {money(income)} · 지출 {money(expense)}</span></TableCell><TableCell className={`text-right text-lg font-black ${net >= 0 ? "text-[#168469]" : "text-[#c94958]"}`} aria-live="polite">{signedMoney(net)}</TableCell>{manageable && <TableCell />}</TableRow></TableFooter>}</Table></div>; }
function BudgetBars({ rows = budgets }: {
    rows?: {
        name: string;
        used: number;
        limit: number;
        color: string;
    }[];
}) { if (!rows.length)
    return <EmptyState title="설정된 예산이 없어요" description="예산을 만들면 사용 현황을 보여드려요."/>; return <div className="space-y-5">{rows.map(r => <div key={r.name}><div className="mb-2 flex justify-between text-sm"><b>{r.name}</b><span className={r.used > r.limit ? "font-bold text-[#e34d5b]" : "text-[#6d7d8b]"}>{money(r.used)} / {money(r.limit)}</span></div><div className="h-2.5 overflow-hidden rounded-full bg-[#e8eff2]"><div className="h-full rounded-full" style={{ width: `${r.limit ? Math.min(100, r.used / r.limit * 100) : 0}%`, background: r.color }}/></div></div>)}</div>; }
function EmptyState({ title, description }: {
    title: string;
    description: string;
}) { return <div className="rounded-2xl bg-[#f5f8fa] px-5 py-10 text-center"><b>{title}</b><p className="mt-1 text-sm text-[#74838d]">{description}</p></div>; }
function EmptyTableRow({ columns, label }: {
    columns: number;
    label: string;
}) { return <TableRow><TableCell colSpan={columns} className="py-10 text-center text-[#74838d]">{label}</TableCell></TableRow>; }
function Mini({ label, value }: {
    label: string;
    value: string;
}) { return <div><p className="text-xs text-white/52">{label}</p><p className="mt-1 text-lg font-bold">{value}</p></div>; }
function AssetMixRow({ label, value, total }: {
    label: string;
    value: number;
    total: number;
}) { const rate = total ? value / total * 100 : 0; return <div><div className="mb-2 flex items-center justify-between text-sm"><span className="text-[#6d7d8b]">{label}</span><b>{assetMoney(value)} · {rate.toFixed(0)}%</b></div><div className="h-2 overflow-hidden rounded-full bg-[#e8eff2]"><div className="h-full rounded-full bg-[#23c6a0]" style={{ width: `${rate}%` }}/></div></div>; }
function MappingSelect({ label, value, columns, required, onChange }: {
    label: string;
    value: number | undefined;
    columns: {
        index: number;
        label: string;
    }[];
    required?: boolean;
    onChange: (value: number | undefined) => void;
}) { return <Label text={label}><Select value={value !== undefined && value >= 0 ? String(value) : "none"} onValueChange={selected => onChange(selected === "none" ? undefined : Number(selected))}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">{required ? "선택 필요" : "사용 안 함"}</SelectItem>{columns.map(column => <SelectItem key={column.index} value={String(column.index)}>{column.label}</SelectItem>)}</SelectContent></Select></Label>; }
function Label({ text, children }: {
    text: string;
    children: React.ReactNode;
}) { return <label className="space-y-1.5 text-sm font-semibold">{text}{children}</label>; }
function Info({ label, value }: {
    label: string;
    value: string;
}) { return <div className="rounded-2xl bg-[#f5f8fa] p-4"><p className="text-sm text-[#6d7d8b]">{label}</p><p className="mt-2 text-xl font-black">{value}</p></div>; }
function Row({ label, value, last }: {
    label: string;
    value: string;
    last?: boolean;
}) { return <div className={`flex justify-between pb-3 ${last ? "" : "border-b"}`}><span>{label}</span><b>{value}</b></div>; }
