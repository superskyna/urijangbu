const API_BASE = "https://apis.data.go.kr/1160100/service/GetStockSecuritiesInfoService";
const OPERATIONS = ["getStockPriceInfo", "getSecuritiesPriceInfo"] as const;

type PublicDataItem = {
  basDt?: string;
  srtnCd?: string;
  itmsNm?: string;
  mrktCtg?: string;
  clpr?: string | number;
};

type Quote = {
  ticker: string;
  name: string;
  market: string;
  price: number;
  date: string;
};

const yyyymmdd = (date: Date) => date.toISOString().slice(0, 10).replaceAll("-", "");

function readItems(payload: unknown): PublicDataItem[] {
  const response = (payload as { response?: unknown })?.response as
    | { header?: { resultCode?: string; resultMsg?: string }; body?: { items?: { item?: PublicDataItem | PublicDataItem[] } } }
    | undefined;
  const code = String(response?.header?.resultCode ?? "");
  if (code && code !== "00" && code !== "0") {
    throw new Error(response?.header?.resultMsg || `공공데이터 오류(${code})`);
  }
  const item = response?.body?.items?.item;
  if (!item) return [];
  return Array.isArray(item) ? item : [item];
}

async function requestQuote(operation: (typeof OPERATIONS)[number], ticker: string, serviceKey: string) {
  const end = new Date();
  end.setUTCDate(end.getUTCDate() + 1);
  const begin = new Date(end);
  begin.setUTCDate(begin.getUTCDate() - 21);

  const url = new URL(`${API_BASE}/${operation}`);
  url.searchParams.set("serviceKey", serviceKey);
  url.searchParams.set("resultType", "json");
  url.searchParams.set("pageNo", "1");
  url.searchParams.set("numOfRows", "30");
  url.searchParams.set("beginBasDt", yyyymmdd(begin));
  url.searchParams.set("endBasDt", yyyymmdd(end));
  url.searchParams.set("likeSrtnCd", ticker);

  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`공공데이터 요청 실패(${response.status})`);
  const payload = await response.json();
  const rows = readItems(payload)
    .filter((item) => String(item.srtnCd ?? "").padStart(6, "0") === ticker)
    .filter((item) => Number(item.clpr) > 0 && item.basDt)
    .sort((a, b) => String(b.basDt).localeCompare(String(a.basDt)));
  return rows[0];
}

async function findQuote(ticker: string, serviceKey: string): Promise<Quote | null> {
  for (const operation of OPERATIONS) {
    const row = await requestQuote(operation, ticker, serviceKey);
    if (row) {
      return {
        ticker,
        name: String(row.itmsNm || ticker),
        market: String(row.mrktCtg || "KRX"),
        price: Number(row.clpr),
        date: String(row.basDt),
      };
    }
  }
  return null;
}

export async function POST(request: Request) {
  const configuredKey = process.env.PUBLIC_DATA_STOCK_API_KEY?.trim();
  if (!configuredKey) {
    return Response.json(
      {
        code: "API_KEY_MISSING",
        message: "공공데이터포털 인증키가 아직 설정되지 않았습니다.",
      },
      { status: 503 },
    );
  }

  let decodedKey = configuredKey;
  try {
    decodedKey = decodeURIComponent(configuredKey);
  } catch {
    // 이미 디코딩된 인증키는 그대로 사용합니다.
  }

  const body = (await request.json().catch(() => null)) as { symbols?: unknown } | null;
  const symbols = Array.isArray(body?.symbols)
    ? [...new Set(body.symbols.filter((value): value is string => typeof value === "string").map((value) => value.trim()))]
    : [];
  const validSymbols = symbols.filter((symbol) => /^\d{6}$/.test(symbol)).slice(0, 30);
  if (!validSymbols.length) {
    return Response.json({ code: "INVALID_SYMBOLS", message: "6자리 국내 종목코드를 입력해주세요." }, { status: 400 });
  }

  try {
    const results = await Promise.all(validSymbols.map((symbol) => findQuote(symbol, decodedKey)));
    const quotes = results.filter((quote): quote is Quote => quote !== null);
    const found = new Set(quotes.map((quote) => quote.ticker));
    return Response.json({ quotes, missing: validSymbols.filter((symbol) => !found.has(symbol)) });
  } catch (error) {
    return Response.json(
      {
        code: "PUBLIC_DATA_ERROR",
        message: error instanceof Error ? error.message : "공공데이터 시세를 불러오지 못했습니다.",
      },
      { status: 502 },
    );
  }
}
