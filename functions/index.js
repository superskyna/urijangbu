const { HttpsError, onCall } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");

const stockApiKey = defineSecret("PUBLIC_DATA_STOCK_API_KEY");
const apiBase = "https://apis.data.go.kr/1160100/service/GetStockSecuritiesInfoService";
const operations = ["getStockPriceInfo", "getSecuritiesPriceInfo"];

const formatDate = (date) => date.toISOString().slice(0, 10).replaceAll("-", "");

function readRows(payload) {
  const response = payload?.response;
  const code = String(response?.header?.resultCode ?? "");
  if (code && code !== "00" && code !== "0") throw new Error(response?.header?.resultMsg || `공공데이터 오류(${code})`);
  const item = response?.body?.items?.item;
  return !item ? [] : Array.isArray(item) ? item : [item];
}

async function getQuote(operation, ticker, serviceKey) {
  const end = new Date();
  end.setUTCDate(end.getUTCDate() + 1);
  const begin = new Date(end);
  begin.setUTCDate(begin.getUTCDate() - 21);
  const url = new URL(`${apiBase}/${operation}`);
  url.searchParams.set("serviceKey", serviceKey);
  url.searchParams.set("resultType", "json");
  url.searchParams.set("pageNo", "1");
  url.searchParams.set("numOfRows", "30");
  url.searchParams.set("beginBasDt", formatDate(begin));
  url.searchParams.set("endBasDt", formatDate(end));
  url.searchParams.set("likeSrtnCd", ticker);
  const result = await fetch(url);
  if (!result.ok) throw new Error(`공공데이터 요청 실패(${result.status})`);
  const row = readRows(await result.json())
    .filter((item) => String(item.srtnCd ?? "").padStart(6, "0") === ticker)
    .filter((item) => Number(item.clpr) > 0 && item.basDt)
    .sort((a, b) => String(b.basDt).localeCompare(String(a.basDt)))[0];
  return row ? { ticker, name: String(row.itmsNm || ticker), market: String(row.mrktCtg || "KRX"), price: Number(row.clpr), date: String(row.basDt) } : null;
}

exports.getStockQuotes = onCall({ region: "asia-northeast3", secrets: [stockApiKey] }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Google 로그인이 필요합니다.");
  const symbols = [...new Set(Array.isArray(request.data?.symbols) ? request.data.symbols : [])]
    .filter((symbol) => typeof symbol === "string" && /^\d{6}$/.test(symbol))
    .slice(0, 30);
  if (!symbols.length) throw new HttpsError("invalid-argument", "6자리 국내 종목코드를 입력해주세요.");
  const serviceKey = stockApiKey.value();
  try {
    const records = await Promise.all(symbols.map(async (symbol) => {
      for (const operation of operations) {
        const quote = await getQuote(operation, symbol, serviceKey);
        if (quote) return quote;
      }
      return null;
    }));
    const quotes = records.filter(Boolean);
    const found = new Set(quotes.map((quote) => quote.ticker));
    return { quotes, missing: symbols.filter((symbol) => !found.has(symbol)) };
  } catch (error) {
    console.error("Stock quote request failed", error);
    throw new HttpsError("internal", error instanceof Error ? error.message : "시세를 불러오지 못했습니다.");
  }
});
