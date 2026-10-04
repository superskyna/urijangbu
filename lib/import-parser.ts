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
const dateLabel = (value: unknown) => {
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

function parseCard(rows: unknown[][]): ImportedTransaction[] {
  const header = rows.findIndex((row) => row.some((cell) => text(cell) === "이용일") && row.some((cell) => text(cell) === "승인번호"));
  if (header < 0) return [];
  const cols = rows[header].map(text);
  const at = (name: string) => cols.indexOf(name);
  return rows.slice(header + 1).flatMap((row) => {
    const usedAt = text(row[at("이용일")]);
    if (!dateLabel(usedAt)) return [];
    const status = text(row[at("상태")]);
    const acquired = text(row[at("매입")]);
    if (status.includes("취소")) return [];
    const merchant = text(row[at("가맹점명")]) || "가맹점 미확인";
    const billed = number(row[at("매입금액")]);
    const approved = number(row[at("승인금액")]);
    const amount = billed || approved;
    if (!amount) return [];
    const approval = text(row[at("승인번호")]);
    const card = text(row[at("이용카드")]);
    return [{ date: dateLabel(usedAt), merchant, category: inferCategory(merchant), account: card || "하나카드", amount: -amount, review: acquired !== "매입", sourceKey: `hana:${card}:${approval}:${usedAt}:${approved}` }];
  });
}

function parseBank(rows: unknown[][]): ImportedTransaction[] {
  const header = rows.findIndex((row) => row.some((cell) => text(cell) === "거래일시") && row.some((cell) => text(cell) === "거래후 잔액"));
  if (header < 0) return [];
  const cols = rows[header].map(text);
  const at = (name: string) => cols.indexOf(name);
  return rows.slice(header + 1).flatMap((row) => {
    const usedAt = text(row[at("거래일시")]);
    if (!dateLabel(usedAt)) return [];
    const out = number(row[at("출금")]);
    const incoming = number(row[at("입금")]);
    const merchant = text(row[at("거래내용")]) || text(row[at("상대계좌예금주명")]) || "거래처 미확인";
    const kind = text(row[at("거래구분")]);
    if (/카드대금|하나카드|삼성카드|롯데카드|기업카드/.test(merchant)) return [];
    const isRefund = /취소|정정/.test(kind);
    const isTransfer = /이체|인터넷/.test(kind);
    const amount = out ? -out : incoming;
    if (!amount) return [];
    return [{ date: dateLabel(usedAt), merchant, category: isRefund ? inferCategory(merchant) : incoming ? "기타·미분류" : inferCategory(merchant), account: "IBK기업은행", amount, review: isTransfer || (!incoming && inferCategory(merchant) === "기타·미분류"), sourceKey: `ibk:${usedAt}:${out}:${incoming}:${merchant}` }];
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
    const rawDate = text(row[dateCol]);
    const date = dateLabel(rawDate.replace(/\//g, "-"));
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
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false });
  const sheets = workbook.SheetNames.map((name) => XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], { header: 1, raw: false, defval: "" }) as unknown[][]);
  const templateRows = sheets.find((rows) => rows.some((row) => row.some((cell) => text(cell) === "거래일") && row.some((cell) => text(cell) === "작성자") && row.some((cell) => /거래처/.test(text(cell)))));
  const cardRows = sheets.find((rows) => rows.some((row) => row.some((cell) => text(cell) === "이용일") && row.some((cell) => text(cell) === "승인번호")));
  const bankRows = sheets.find((rows) => rows.some((row) => row.some((cell) => text(cell) === "거래일시") && row.some((cell) => text(cell) === "거래후 잔액")));
  const institution = templateRows ? "우리장부 거래양식" : cardRows ? "하나카드" : bankRows ? "IBK기업은행" : "알 수 없는 기관";
  const rows = templateRows ?? cardRows ?? bankRows ?? sheets[0] ?? [];
  const transactions = institution === "우리장부 거래양식" ? parseUribook(rows) : institution === "하나카드" ? parseCard(rows) : institution === "IBK기업은행" ? parseBank(rows) : [];
  return { institution, transactions, replaceExisting: institution === "우리장부 거래양식", needsReview: transactions.filter((item) => item.review).length };
}
