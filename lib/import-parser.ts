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

export type ManualColumnMapping = {
  sheetIndex: number;
  headerRow: number;
  dateCol: number;
  merchantCol: number;
  amountCol: number;
  statusCol?: number;
  accountCol?: number;
};

export type ManualImportSuggestion = {
  sheetName: string;
  signature: string;
  columns: { index: number; label: string }[];
  mapping: ManualColumnMapping;
};

const text = (value: unknown) => String(value ?? "").trim();
const number = (value: unknown) => Number(text(value).replace(/[^0-9.-]/g, "")) || 0;
const headerText = (value: unknown) => text(value)
  .replace(/[（(][^）)]*[）)]/g, "")
  .replace(/[\s\r\n]+/g, "")
  .toLowerCase();
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

type WorkbookSheet = { name: string; rows: unknown[][] };

async function readWorkbook(file: File): Promise<WorkbookSheet[]> {
  const XLSX = await import("xlsx");
  // Keep Excel dates as serial numbers. Converting them to Date objects here can
  // shift a midnight cell to the previous day depending on the local timezone.
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false });
  return workbook.SheetNames.map((name) => ({
    name,
    rows: XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], { header: 1, raw: true, defval: "" }) as unknown[][],
  }));
}

const likelyColumn = (columns: string[], pattern: RegExp) => columns.findIndex((column) => pattern.test(headerText(column)));

function suggestManualMapping(sheets: WorkbookSheet[]): ManualImportSuggestion | undefined {
  const candidates = sheets.flatMap((sheet, sheetIndex) => sheet.rows.slice(0, 50).map((row, headerRow) => {
    const columns = row.map(text);
    const filled = columns.filter(Boolean);
    const keywordScore = filled.filter((column) => /(일자|날짜|date|가맹|이용처|사용처|거래처|상호|merchant|금액|amount|결제액|사용액|취소|상태|카드|계좌)/i.test(headerText(column))).length;
    const valueLike = filled.filter((column) => Boolean(dateLabel(column)) || /^[-+]?\d[\d,.]*$/.test(column)).length;
    return { sheet, sheetIndex, headerRow, columns, score: keywordScore * 4 + filled.length - valueLike * 2 };
  })).filter((candidate) => candidate.columns.filter(Boolean).length >= 3).sort((a, b) => b.score - a.score);
  const candidate = candidates[0];
  if (!candidate) return undefined;
  const columns = candidate.columns.map((label, index) => ({ index, label: label || `열 ${index + 1}` }));
  const dateCol = likelyColumn(candidate.columns, /(일자|날짜|date)/i);
  const merchantCol = likelyColumn(candidate.columns, /(가맹|이용처|사용처|거래처|상호|merchant)/i);
  const amountCol = likelyColumn(candidate.columns, /(금액|amount|결제액|사용액|지출액)/i);
  const statusCol = likelyColumn(candidate.columns, /(취소|상태|status)/i);
  const accountCol = likelyColumn(candidate.columns, /(카드번호|카드명|이용카드|계좌|account)/i);
  return {
    sheetName: candidate.sheet.name,
    signature: candidate.columns.map(headerText).join("|"),
    columns,
    mapping: {
      sheetIndex: candidate.sheetIndex,
      headerRow: candidate.headerRow,
      dateCol,
      merchantCol,
      amountCol,
      ...(statusCol >= 0 ? { statusCol } : {}),
      ...(accountCol >= 0 ? { accountCol } : {}),
    },
  };
}
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
  const sheets = await readWorkbook(file);
  const templateSheet = sheets.find(({ rows }) => rows.some((row) => row.some((cell) => text(cell) === "거래일") && row.some((cell) => text(cell) === "작성자") && row.some((cell) => /거래처/.test(text(cell)))));
  const cardSheet = sheets.find(({ rows }) => cardHeaderIndex(rows) >= 0);
  const bankSheet = sheets.find(({ rows }) => rows.some((row) => row.some((cell) => text(cell) === "거래일시") && row.some((cell) => text(cell) === "거래후 잔액")));
  const fileLabel = headerText(file.name);
  const cardInstitution = /농협|NH|일시불\+?할부_?카드이용내역조회/i.test(fileLabel)
    ? "NH농협카드"
    : /하나/i.test(fileLabel) ? "하나카드" : "카드 이용내역";
  const institution = templateSheet ? "우리장부 거래양식" : cardSheet ? cardInstitution : bankSheet ? "IBK기업은행" : "알 수 없는 기관";
  const rows = (templateSheet ?? cardSheet ?? bankSheet)?.rows ?? [];
  const transactions = institution === "우리장부 거래양식" ? parseUribook(rows) : cardSheet ? parseCard(rows, institution) : institution === "IBK기업은행" ? parseBank(rows) : [];
  return {
    institution,
    transactions,
    replaceExisting: institution === "우리장부 거래양식",
    needsReview: transactions.filter((item) => item.review).length,
    manualSuggestion: transactions.length ? undefined : suggestManualMapping(sheets),
  };
}

export async function parseFinanceFileWithMapping(file: File, mapping: ManualColumnMapping) {
  const sheets = await readWorkbook(file);
  const sheet = sheets[mapping.sheetIndex];
  if (!sheet) throw new Error("선택한 시트를 찾지 못했습니다.");
  if ([mapping.dateCol, mapping.merchantCol, mapping.amountCol].some((column) => column < 0)) {
    throw new Error("날짜, 거래처, 금액 열을 모두 선택해주세요.");
  }
  if (new Set([mapping.dateCol, mapping.merchantCol, mapping.amountCol]).size !== 3) {
    throw new Error("날짜, 거래처, 금액은 서로 다른 열을 선택해주세요.");
  }
  const transactions = sheet.rows.slice(mapping.headerRow + 1).flatMap((row, index) => {
    const dateValue = row[mapping.dateCol];
    const date = dateLabel(dateValue);
    const merchant = text(row[mapping.merchantCol]);
    const amount = number(row[mapping.amountCol]);
    const status = mapping.statusCol === undefined ? "" : text(row[mapping.statusCol]);
    if (!date || !merchant || amount <= 0 || /취소|cancel|void/i.test(status)) return [];
    const account = mapping.accountCol === undefined ? "수동 매핑 카드" : text(row[mapping.accountCol]) || "수동 매핑 카드";
    return [{
      date,
      merchant,
      category: inferCategory(merchant),
      account,
      amount: -Math.abs(amount),
      review: false,
      sourceKey: `manual:${mapping.sheetIndex}:${mapping.headerRow}:${index}:${text(dateValue)}:${merchant}:${amount}`,
    }];
  });
  return { institution: "수동 열 매핑", transactions, replaceExisting: false, needsReview: 0 };
}
