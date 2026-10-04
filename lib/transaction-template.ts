export type TransactionTemplateRow = {
  owner: string;
  date: string;
  merchant: string;
  category: string;
  account: string;
  amount: number;
};

const headers = ["거래일", "작성자", "거래처·내용", "분류", "계좌·카드", "구분", "금액", "메모"];

function fullDate(value: string) {
  const normalized = value.trim().replace(/[./]/g, "-");
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return normalized;
  const matched = normalized.match(/^(\d{1,2})-(\d{1,2})$/);
  return matched ? `${new Date().getFullYear()}-${matched[1].padStart(2, "0")}-${matched[2].padStart(2, "0")}` : normalized;
}

function localDateLabel(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export async function downloadTransactionTemplate(transactions: TransactionTemplateRow[]) {
  const XLSX = await import("xlsx");
  let workbook: XLSX.WorkBook;
  try {
    const response = await fetch("/templates/우리장부_거래내역_입력양식.xlsx");
    if (!response.ok) throw new Error("template unavailable");
    workbook = XLSX.read(await response.arrayBuffer(), { type: "array", cellStyles: true });
  } catch {
    workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([headers]), "거래내역");
  }

  const sheet = workbook.Sheets["거래내역"] ?? XLSX.utils.aoa_to_sheet([headers]);
  if (!workbook.Sheets["거래내역"]) XLSX.utils.book_append_sheet(workbook, sheet, "거래내역");
  for (let row = 1; row < 300; row += 1) {
    for (let column = 0; column < headers.length; column += 1) {
      const address = XLSX.utils.encode_cell({ r: row, c: column });
      const cell = sheet[address] as (XLSX.CellObject & { s?: unknown }) | undefined;
      if (!cell) continue;
      cell.t = "s";
      cell.v = "";
      delete cell.w;
      delete cell.f;
    }
  }
  const rows = transactions.map((transaction) => [
    fullDate(transaction.date),
    transaction.owner,
    transaction.merchant,
    transaction.category,
    transaction.account,
    transaction.amount >= 0 ? "수입" : "지출",
    Math.abs(transaction.amount),
    "",
  ]);
  XLSX.utils.sheet_add_aoa(sheet, [headers, ...rows], { origin: "A1" });
  sheet["!ref"] = "A1:H300";
  sheet["!autofilter"] = { ref: `A1:H${Math.max(2, rows.length + 1)}` };
  sheet["!cols"] = [{ wch: 14 }, { wch: 12 }, { wch: 24 }, { wch: 17 }, { wch: 18 }, { wch: 10 }, { wch: 15 }, { wch: 26 }];

  XLSX.writeFile(workbook, `우리장부_거래내역_${localDateLabel(new Date())}.xlsx`, { compression: true });
}
