export type ImportedSaving = { owner:string; name:string; institution:string; balance:number; currency:string; date:string; note:string };
export type ImportedInvestment = { owner:string; name:string; ticker:string; market:string; currency:string; quantity:number; averagePrice:number; currentPrice:number; invested:number; date:string; note:string };
export type ImportedLoan = { owner:string; name:string; institution:string; principal:number; rate:number; monthlyPayment:number; date:string; note:string };
export type ImportedAssets = { savings:ImportedSaving[]; investments:ImportedInvestment[]; loans:ImportedLoan[]; total:number };

const clean = (value:unknown) => String(value ?? "").trim();
const key = (value:unknown) => clean(value).replace(/\*/g, "").replace(/\s+/g, "");
const amount = (value:unknown) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  return Number(clean(value).replace(/,/g, "").replace(/[^0-9.-]/g, "")) || 0;
};
const dateText = (value:unknown) => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  return clean(value).replace(/\./g, "-").slice(0, 10);
};

export async function parseAssetFile(file:File):Promise<ImportedAssets> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(await file.arrayBuffer(), { type:"array", cellDates:true });
  const rows = (sheetName:string) => {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) return [] as Record<string,unknown>[];
    const raw = XLSX.utils.sheet_to_json<Record<string,unknown>>(sheet, { range:3, defval:"", raw:true });
    return raw.map(row => Object.fromEntries(Object.entries(row).map(([header,value]) => [key(header), value])));
  };

  const savings = rows("저축·예금").flatMap((row):ImportedSaving[] => {
    const name=clean(row["자산명"]), institution=clean(row["금융기관"]), balance=amount(row["현재잔액"]);
    if (!name && !institution && !balance) return [];
    if (!name || !institution || !balance) return [];
    return [{ owner:clean(row["작성자"]), name, institution, balance, currency:clean(row["통화"]).toUpperCase()||"KRW", date:dateText(row["기준일"]), note:clean(row["메모"]) }];
  });
  const investments = rows("주식·ETF").flatMap((row):ImportedInvestment[] => {
    const name=clean(row["종목명"]), ticker=clean(row["티커"]), quantity=amount(row["보유수량"]), averagePrice=amount(row["평균매입가"]);
    if (!name && !ticker && !quantity && !averagePrice) return [];
    if (!name || !ticker || !quantity || !averagePrice) return [];
    return [{ owner:clean(row["작성자"]), name, ticker, market:clean(row["시장"])||"기타", currency:clean(row["통화"]).toUpperCase()||"KRW", quantity, averagePrice, currentPrice:amount(row["현재가"]), invested:amount(row["투자금"]), date:dateText(row["기준일"]), note:clean(row["메모"]) }];
  });
  const loans = rows("대출").flatMap((row):ImportedLoan[] => {
    const name=clean(row["대출명"]), institution=clean(row["금융기관"]), principal=amount(row["남은원금"]);
    if (!name && !institution && !principal) return [];
    if (!name || !institution || !principal) return [];
    return [{ owner:clean(row["작성자"]), name, institution, principal, rate:amount(row["금리(%)"]), monthlyPayment:amount(row["월상환액"]), date:dateText(row["기준일"]), note:clean(row["메모"]) }];
  });
  const total=savings.length+investments.length+loans.length;
  if (!total) throw new Error("양식의 저축·예금, 주식·ETF, 대출 시트에서 입력된 항목을 찾지 못했습니다.");
  return { savings, investments, loans, total };
}
