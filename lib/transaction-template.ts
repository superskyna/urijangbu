import { merchantCategoryRules, transactionCategories } from "@/lib/category-master";

export type TransactionTemplateRow = {
  owner: string;
  date: string;
  merchant: string;
  category: string;
  account: string;
  amount: number;
};

const headers = ["거래일", "작성자", "거래처·내용", "분류", "계좌·카드", "구분", "금액", "메모"];
const maxRows = 500;

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
  const { Workbook } = await import("exceljs");
  const workbook = new Workbook();
  workbook.creator = "우리장부";
  workbook.created = new Date();

  const transactionSheet = workbook.addWorksheet("거래내역", {
    views: [{ state: "frozen", ySplit: 1, showGridLines: false }],
  });
  const masterSheet = workbook.addWorksheet("분류마스터", { views: [{ state: "frozen", ySplit: 1, showGridLines: false }] });
  const guideSheet = workbook.addWorksheet("작성안내", { views: [{ showGridLines: false }] });

  transactionSheet.columns = [
    { header: headers[0], key: "date", width: 14 },
    { header: headers[1], key: "owner", width: 12 },
    { header: headers[2], key: "merchant", width: 26 },
    { header: headers[3], key: "category", width: 18 },
    { header: headers[4], key: "account", width: 20 },
    { header: headers[5], key: "kind", width: 10 },
    { header: headers[6], key: "amount", width: 16 },
    { header: headers[7], key: "memo", width: 28 },
  ];
  transactionSheet.autoFilter = `A1:H${maxRows}`;
  transactionSheet.getRow(1).height = 25;
  transactionSheet.getRow(1).eachCell((cell) => {
    cell.font = { name: "Arial", bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF173F69" } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
  });

  masterSheet.columns = [
    { header: "거래처 키워드", key: "keyword", width: 24 },
    { header: "자동 분류", key: "mappedCategory", width: 18 },
    { header: "", key: "spacer", width: 4 },
    { header: "사용 가능한 분류", key: "category", width: 22 },
  ];
  masterSheet.getRow(1).eachCell((cell) => {
    cell.font = { name: "Arial", bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF287B67" } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
  });
  merchantCategoryRules.forEach((rule, index) => {
    masterSheet.getCell(index + 2, 1).value = rule.keyword;
    masterSheet.getCell(index + 2, 2).value = rule.category;
  });
  transactionCategories.forEach((category, index) => {
    masterSheet.getCell(index + 2, 4).value = category;
  });
  masterSheet.getCell("F1").value = "관리 안내";
  masterSheet.getCell("F1").font = { name: "Arial", bold: true, color: { argb: "FF173F69" } };
  masterSheet.getCell("F2").value = "거래처 키워드와 자동 분류를 수정하면 거래내역 시트의 새 행에 반영됩니다.";
  masterSheet.getCell("F2").alignment = { wrapText: true, vertical: "top" };
  masterSheet.getColumn("F").width = 54;

  const categoryEndRow = transactionCategories.length + 1;
  workbook.definedNames.add(`'분류마스터'!$D$2:$D$${categoryEndRow}`, "거래분류목록");
  const mappingEndRow = merchantCategoryRules.length + 1;
  const sorted = [...transactions].sort((a, b) => fullDate(a.date).localeCompare(fullDate(b.date), "ko"));

  for (let rowNumber = 2; rowNumber <= maxRows; rowNumber += 1) {
    const transaction = sorted[rowNumber - 2];
    const row = transactionSheet.getRow(rowNumber);
    if (transaction) {
      const parsedDate = new Date(`${fullDate(transaction.date)}T00:00:00`);
      row.getCell(1).value = Number.isNaN(parsedDate.getTime()) ? fullDate(transaction.date) : parsedDate;
      row.getCell(2).value = transaction.owner;
      row.getCell(3).value = transaction.merchant;
      row.getCell(5).value = transaction.account;
      row.getCell(6).value = transaction.amount >= 0 ? "수입" : "지출";
      row.getCell(7).value = Math.abs(transaction.amount);
    }
    row.getCell(4).value = {
      formula: `IF(C${rowNumber}="","",IFERROR(LOOKUP(2,1/ISNUMBER(SEARCH('분류마스터'!$A$2:$A$${mappingEndRow},C${rowNumber}))),'분류마스터'!$B$2:$B$${mappingEndRow}),"기타·미분류"))`,
      result: transaction?.category ?? "",
    };
    row.getCell(4).dataValidation = {
      type: "list",
      allowBlank: true,
      showErrorMessage: true,
      errorStyle: "error",
      errorTitle: "사용할 수 없는 분류",
      error: "분류마스터의 사용 가능한 분류에서 선택해주세요.",
      formulae: ["거래분류목록"],
    };
    row.getCell(6).dataValidation = {
      type: "list",
      allowBlank: true,
      showErrorMessage: true,
      errorTitle: "구분 확인",
      error: "지출 또는 수입 중 하나를 선택해주세요.",
      formulae: ['"지출,수입"'],
    };
    row.getCell(1).numFmt = "yyyy-mm-dd";
    row.getCell(7).numFmt = "#,##0";
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.font = { name: "Arial", size: 10 };
      cell.alignment = { vertical: "middle" };
      cell.border = { bottom: { style: "hair", color: { argb: "FFDCE5E9" } } };
    });
  }

  guideSheet.columns = [{ width: 20 }, { width: 72 }];
  guideSheet.mergeCells("A1:B1");
  guideSheet.getCell("A1").value = "우리장부 거래내역 입력 방법";
  guideSheet.getCell("A1").font = { name: "Arial", size: 16, bold: true, color: { argb: "FF173F69" } };
  guideSheet.getCell("A1").alignment = { vertical: "middle" };
  guideSheet.getRow(1).height = 30;
  const guideRows = [
    ["항목", "입력 방법"],
    ["거래일", "yyyy-mm-dd 형식으로 입력합니다. 내려받은 거래는 날짜 오름차순으로 정렬됩니다."],
    ["거래처·내용", "거래처를 입력하면 분류마스터의 키워드를 기준으로 분류가 자동 입력됩니다."],
    ["분류", "목록에 있는 분류만 사용할 수 있습니다. 직접 바꾸려면 드롭다운에서 선택하세요."],
    ["분류마스터", "거래처 키워드와 자동 분류 규칙을 한곳에서 관리합니다."],
    ["구분", "지출 또는 수입 중 하나를 선택합니다."],
    ["금액", "부호 없이 양수로 입력합니다. 지출·수입 구분은 구분 열에서 정합니다."],
    ["다시 업로드", "이 양식으로 올리면 거래내역 시트의 내용으로 기존 목록 전체를 갱신합니다."],
  ];
  guideSheet.addRows(guideRows);
  guideSheet.getRow(2).eachCell((cell) => {
    cell.font = { name: "Arial", bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF287B67" } };
  });
  guideSheet.getRows(3, guideRows.length - 1)?.forEach((row) => {
    row.height = 30;
    row.eachCell((cell) => {
      cell.font = { name: "Arial", size: 10 };
      cell.alignment = { vertical: "middle", wrapText: true };
      cell.border = { bottom: { style: "thin", color: { argb: "FFDCE5E9" } } };
    });
  });

  const output = await workbook.xlsx.writeBuffer();
  const blob = new Blob([new Uint8Array(output)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `우리장부_거래내역_${localDateLabel(new Date())}.xlsx`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
