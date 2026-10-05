import { inferTransactionCategory, isTransactionCategory } from "@/lib/category-master";

export type ImportedTransaction = {
  owner?: string;
  date: string;
  merchant: string;
  category: string;
  account: string;
  amount: number;
  review: boolean;
  sourceKey: string;
};

const text = (value: unknown) => String(value ?? "").trim();
const number = (value: unknown) => Number(text(value).replace(/[^0-9.-]/g, "")) || 0;
const headerText = (value: unknown) => text(value).replace(/[\s\r\n]+/g, "");
const CARD_HEADERS = {
  date: ["이용일", "이용일자", "승인일", "승인일자", "사용일", "사용일자", "매출일", "매출일자"],
  merchant: ["가맹점명", "이용가맹점", "이용가맹점명", "가맹점", "이용처", "사용처"],
  amount: ["매입금액", "승인금액", "이용금액", "사용금액", "국내이용금액", "결제금액"],
  approval: ["승인번호", "승인No", "승인NO"],
  card: ["이용카드", "카드번호", "카드명", "이용카드번호"],
  status: ["상태", "승인상태", "이용상태", "취소여부"],
  acquired: ["매입", "매입상태", "매입여부"],
} as const;

const columnIndex = (columns: string[], names: readonly string[]) => {
  const normalized = names.map(headerText);
  return columns.findIndex((column) => normalized.includes(headerText(column)));
};

const cardHeaderIndex = (rows: unknown[][]) => rows.findIndex((row) => {
  const columns = row.map(text);
  return columnIndex(columns, CARD_HEADERS.date) >= 0
    && columnIndex(columns, CARD_HEADERS.merchant) >= 0
    && columnIndex(columns, CARD_HEADERS.amount) >= 0;
});
const dateLabel = (value: unknown) => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86_400_000);
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
  }
  const raw = text(value);
  const yearFirst = raw.match(/(\d{4})[./-](\d{1,2})[./-](\d{1,2})/);
  if (yearFirst) return `${yearFirst[1]}-${yearFirst[2].padStart(2, "0")}-${yearFirst[3].padStart(2, "0")}`;
  const monthFirst = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (monthFirst) {
    const year = monthFirst[3].length === 2 ? `20${monthFirst[3]}` : monthFirst[3];
    return `${year}-${monthFirst[1].padStart(2, "0")}-${monthFirst[2].padStart(2, "0")}`;
  }
  const short = raw.match(/^(\d{1,2})[./-](\d{1,2})$/);
  return short ? `${new Date().getFullYear()}-${short[1].padStart(2, "0")}-${short[2].padStart(2, "0")}` : "";
};

export function inferCategory(merchant: string) {
  return inferTransactionCategory(merchant);
}

function parseCard(rows: unknown[][], defaultAccount: string): ImportedTransaction[] {
  const header = cardHeaderIndex(rows);
  if (header < 0) return [];
  const cols = rows[header].map(text);
  const dateCol = columnIndex(cols, CARD_HEADERS.date);
  const merchantCol = columnIndex(cols, CARD_HEADERS.merchant);
  const amountCols = CARD_HEADERS.amount
    .map((name) => columnIndex(cols, [name]))
    .filter((index, position, indexes) => index >= 0 && indexes.indexOf(index) === position);
  const approvalCol = columnIndex(cols, CARD_HEADERS.approval);
  const cardCol = columnIndex(cols, CARD_HEADERS.card);
  const statusCol = columnIndex(cols, CARD_HEADERS.status);
  const acquiredCol = columnIndex(cols, CARD_HEADERS.acquired);
  return rows.slice(header + 1).flatMap((row, index) => {
    const usedAtValue = row[dateCol];
    const usedAt = text(usedAtValue);
    if (!dateLabel(usedAtValue)) return [];
    const status = statusCol >= 0 ? text(row[statusCol]) : "";
    const acquired = acquiredCol >= 0 ? text(row[acquiredCol]) : "";
    if (status.includes("취소")) return [];
    const merchant = text(row[merchantCol]) || "가맹점 미확인";
    const amount = amountCols.map((column) => number(row[column])).find((value) => value !== 0) ?? 0;
    if (amount <= 0) return [];
    const approval = approvalCol >= 0 ? text(row[approvalCol]) : "";
    const card = cardCol >= 0 ? text(row[cardCol]) : "";
    return [{ date: dateLabel(usedAtValue), merchant, category: inferCategory(merchant), account: card || defaultAccount, amount: -amount, review: Boolean(acquired && acquired !== "매입") || !approval, sourceKey: `card:${card}:${approval || index}:${usedAt}:${merchant}:${amount}` }];
  });
}

function parseBank(rows: unknown[][]): ImportedTransaction[] {
  const header = rows.findIndex((row) => row.some((cell) => text(cell) === "거래일시") && row.some((cell) => text(cell) === "거래후 잔액"));
  if (header < 0) return [];
  const cols = rows[header].map(text);
  const at = (name: string) => cols.indexOf(name);
  return rows.slice(header + 1).flatMap((row) => {
    const usedAtValue = row[at("거래일시")];
    const usedAt = text(usedAtValue);
    if (!dateLabel(usedAtValue)) return [];
    const out = number(row[at("출금")]);
    const incoming = number(row[at("입금")]);
    const merchant = text(row[at("거래내용")]) || text(row[at("상대계좌예금주명")]) || "거래처 미확인";
    const kind = text(row[at("거래구분")]);
    if (/카드대금|하나카드|삼성카드|롯데카드|기업카드/.test(merchant)) return [];
    const isRefund = /취소|정정/.test(kind);
    const isTransfer = /이체|인터넷/.test(kind);
    const amount = out ? -out : incoming;
    if (!amount) return [];
    return [{ date: dateLabel(usedAtValue), merchant, category: isRefund ? inferCategory(merchant) : incoming ? "기타·미분류" : inferCategory(merchant), account: "IBK기업은행", amount, review: isTransfer || (!incoming && inferCategory(merchant) === "기타·미분류"), sourceKey: `ibk:${usedAt}:${out}:${incoming}:${merchant}` }];
  });
}

function parseUribook(rows: unknown[][]): ImportedTransaction[] {
  const header = rows.findIndex((row) => row.some((cell) => text(cell) === "거래일") && row.some((cell) => text(cell) === "작성자") && row.some((cell) => /거래처/.test(text(cell))));
  if (header < 0) return [];
  const cols = rows[header].map(text);
  const at = (...names: string[]) => cols.findIndex((column) => names.includes(column));
  const dateCol = at("거래일", "날짜");
  const ownerCol = at("작성자");
  const merchantCol = at("거래처·내용", "거래처", "내용");
  const categoryCol = at("분류", "카테고리");
  const accountCol = at("계좌·카드", "계좌/카드", "계좌", "카드");
  const kindCol = at("구분", "수입/지출");
  const amountCol = at("금액", "금액(원)");
  return rows.slice(header + 1).flatMap((row, index) => {
    const merchant = text(row[merchantCol]);
    const amountValue = number(row[amountCol]);
    if (!merchant || !amountValue) return [];
    const kind = text(row[kindCol]);
    const rawDateValue = row[dateCol];
    const rawDate = text(rawDateValue);
    const date = dateLabel(rawDateValue);
    const enteredCategory = text(row[categoryCol]);
    const category = isTransactionCategory(enteredCategory) ? enteredCategory : inferCategory(merchant);
    const account = text(row[accountCol]) || "직접 입력";
    const owner = text(row[ownerCol]);
    const amount = /수입|입금/.test(kind) ? Math.abs(amountValue) : /지출|출금/.test(kind) ? -Math.abs(amountValue) : amountValue;
    return [{ owner, date, merchant, category, account, amount, review: !date || !owner || (!!enteredCategory && !isTransactionCategory(enteredCategory)), sourceKey: `uribook:${index}:${rawDate}:${merchant}:${amount}` }];
  });
}

export async function parseFinanceFile(file: File) {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
  const sheets = workbook.SheetNames.map((name) => XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], { header: 1, raw: true, defval: "" }) as unknown[][]);
  const templateRows = sheets.find((rows) => rows.some((row) => row.some((cell) => text(cell) === "거래일") && row.some((cell) => text(cell) === "작성자") && row.some((cell) => /거래처/.test(text(cell)))));
  const cardRows = sheets.find((rows) => cardHeaderIndex(rows) >= 0);
  const bankRows = sheets.find((rows) => rows.some((row) => row.some((cell) => text(cell) === "거래일시") && row.some((cell) => text(cell) === "거래후 잔액")));
  const fileLabel = headerText(file.name);
  const cardInstitution = /농협|NH|일시불\+?할부_?카드이용내역조회/i.test(fileLabel)
    ? "NH농협카드"
    : /하나/i.test(fileLabel) ? "하나카드" : "카드 이용내역";
  const institution = templateRows ? "우리장부 거래양식" : cardRows ? cardInstitution : bankRows ? "IBK기업은행" : "알 수 없는 기관";
  const rows = templateRows ?? cardRows ?? bankRows ?? sheets[0] ?? [];
  const transactions = institution === "우리장부 거래양식" ? parseUribook(rows) : cardRows ? parseCard(rows, institution) : institution === "IBK기업은행" ? parseBank(rows) : [];
  return { institution, transactions, replaceExisting: institution === "우리장부 거래양식", needsReview: transactions.filter((item) => item.review).length };
}
