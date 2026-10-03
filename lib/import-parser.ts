export type ImportedTransaction = {
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
  const matched = text(value).match(/(\d{4})[.-](\d{1,2})[.-](\d{1,2})/);
  return matched ? `${matched[2].padStart(2, "0")}.${matched[3].padStart(2, "0")}` : text(value).slice(0, 5);
};

export function inferCategory(merchant: string) {
  const normalized = merchant.replace(/\s+/g, "").toLowerCase();
  if (/올리브영/.test(normalized)) return "쇼핑";
  if (/이마트|홈플러스|롯데마트|코스트코|하나로마트|대형마트/.test(normalized)) return "식비";
  if (/병원|의원|약국|한의원|안과|치과/.test(normalized)) return "의료비";
  if (/철도|코레일|티머니|카카오t|택시|하이패스|교통/.test(normalized)) return "교통비";
  if (/주유|오일뱅크|칼텍스|s-oil|에쓰오일/.test(normalized)) return "주유";
  if (/카센타|카센터|정비|세차|자동차용품/.test(normalized)) return "차량관리";
  if (/헬스|필라테스|수영|요가|pt/.test(normalized)) return "운동";
  if (/보험/.test(normalized)) return "보험";
  if (/통신|넷플릭스|유튜브|멜론|구독/.test(normalized)) return "통신·구독";
  if (/계비|친목회|동창회|모임회비/.test(normalized)) return "계모임";
  if (/마트|카페|커피|식당|푸드|토스트|배달|쿠팡이츠|배민/.test(normalized)) return "식비";
  if (/다이소|생활용품/.test(normalized)) return "생활용품";
  return "기타·미분류";
}

function parseCard(rows: unknown[][]): ImportedTransaction[] {
  const header = rows.findIndex((row) => row.some((cell) => text(cell) === "이용일") && row.some((cell) => text(cell) === "승인번호"));
  if (header < 0) return [];
  const cols = rows[header].map(text);
  const at = (name: string) => cols.indexOf(name);
  return rows.slice(header + 1).flatMap((row) => {
    const usedAt = text(row[at("이용일")]);
    if (!/^\d{4}[.-]\d{1,2}[.-]\d{1,2}/.test(usedAt)) return [];
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
    if (!/^\d{4}[.-]\d{1,2}[.-]\d{1,2}/.test(usedAt)) return [];
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

export async function parseFinanceFile(file: File) {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: "" }) as unknown[][];
  const joined = rows.slice(0, 8).flat().map(text).join(" ");
  const institution = /이용일.*승인번호|카드이용내역/.test(joined) ? "하나카드" : /거래일시.*거래후 잔액|IBK|입출식/.test(joined) ? "IBK기업은행" : "알 수 없는 기관";
  const transactions = institution === "하나카드" ? parseCard(rows) : institution === "IBK기업은행" ? parseBank(rows) : [];
  return { institution, transactions, needsReview: transactions.filter((item) => item.review).length };
}
